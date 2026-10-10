import { randomUUID } from "node:crypto";
import { idempotencyKeys, runs, tasks } from "@trigger.dev/sdk";
import { getJob, mutateJob } from "./store.js";
import { resolveGenerationReview } from "./generation-review.js";
import { saveRunReceipt } from "./run-receipts.js";
import { ANALYSIS_TASK_ID, CV_TASK_ID, TERMINAL_RUN_STATUSES, assertStorageDispatch } from "./task-policy.js";
import { getApplicationCv, claimApplicationCvRun, updateApplicationCvRun } from "./application-cv-store.js";

const active = run => ["dispatching", "queued", "running"].includes(run?.status);

async function applicationRunActive(run) {
  if (!active(run)) return false;
  if (!run.runId) return true;
  const status = (await runs.retrieve(run.runId).catch(() => null))?.status;
  return !status || !TERMINAL_RUN_STATUSES.has(status);
}

// Reviewing authorizes a missing fit report and customised CV. Reuse the existing
// analysis checkpoint before dispatching CV work; cover letters are manual only.
// The storage guard checks the app's deployment settings. A task worker that
// follows up its own analysis already runs against the same store and Trigger
// environment, so it skips that app-only check.
export async function ensureReviewingGeneration(jobId, { fromWorker = false } = {}) {
  let job = await getJob(jobId);
  if (!job || job.stage !== "reviewing" || job.archived) return;
  // A "Fit page & CV" run writes the analysis and then its own CV. Its
  // analysis child must not start a second CV that the parent then has to
  // refuse as already running.
  if (await applicationRunActive(job.applicationRun)) return;
  const application = job.fitReportId ? await getApplicationCv(jobId) : null;
  const kind = !job.fitReportId ? "analyse" : !application?.currentVersionId ? "cv" : null;
  if (!kind) return;
  const field = "analysisRun";
  const prior = kind === "cv" ? application?.run : job[field];
  if (kind === "cv" && prior?.status === "needs_review") return;
  if (active(prior) && prior.runId) {
    const run = await runs.retrieve(prior.runId);
    if (!TERMINAL_RUN_STATUSES.has(run.status)) return;
    const settled = { status: run.status === "COMPLETED" ? (run.output?.outcome || "completed") : "failed", finishedAt: new Date().toISOString() };
    if (kind === "cv") await updateApplicationCvRun(jobId, prior.requestId, settled);
    else await mutateJob(jobId, current => current[field]?.requestId === prior.requestId && active(current[field])
      ? { [field]: { ...current[field], ...settled } } : undefined);
    job = await getJob(jobId);
    if (!job || job.stage !== "reviewing" || job.archived || (kind === "analyse" ? job.fitReportId : (await getApplicationCv(jobId))?.currentVersionId)) return;
    // Content/layout failures need an explicit retry rather than another paid
    // request on a repeated status update.
    if (kind === "cv" && settled.status === "needs_review") return;
  }
  if (!fromWorker) assertStorageDispatch();
  const resolved = await resolveGenerationReview({ kind, id: jobId });
  const pending = { requestId: "reviewing_" + randomUUID(), runId: "", model: resolved.model,
    fingerprint: resolved.workFingerprint, status: "dispatching", startedAt: new Date().toISOString(), finishedAt: "" };
  let selected;
  if (kind === "cv") {
    const latest = await getJob(jobId);
    if (!latest || latest.stage !== "reviewing" || latest.archived) return;
    const claimed = await claimApplicationCvRun(latest, pending);
    selected = claimed?.run || claimed;
    if (!selected?.requestId) return;
    if (selected.requestId !== pending.requestId && !String(selected.requestId).startsWith("reviewing_")) return;
    if (selected.fingerprint !== pending.fingerprint || selected.runId) return;
  } else await mutateJob(jobId, current => {
    selected = undefined;
    if (current.stage !== "reviewing" || current.archived || current.fitReportId) return;
    if (active(current[field])) {
      // Recover an uncertain automatic dispatch with its original idempotency key.
      // Never take over manual work or a request built from different inputs.
      if (!current[field].runId && String(current[field].requestId || "").startsWith("reviewing_") && current[field].fingerprint === pending.fingerprint) selected = current[field];
      return;
    }
    selected = pending;
    return { [field]: pending };
  });
  if (!selected) return;
  const { requestId } = selected;
  const key = await idempotencyKeys.create(`${kind}:${jobId}:${requestId}`, { scope: "global" });
  const handle = await tasks.trigger(kind === "analyse" ? ANALYSIS_TASK_ID : CV_TASK_ID,
    { jobId, requestId, fingerprint: resolved.workFingerprint, ...resolved.payload,
      ...(kind === "cv" ? { origin: (process.env.PUBLIC_BASE_URL || "https://fit.bernardoraposo.com").replace(/\/$/, ""), automatic: true } : {}) },
    { idempotencyKey: key, idempotencyKeyTTL: "30d", tags: [`job:${jobId}`, `request:${requestId}`] });
  await saveRunReceipt({ kind, requestId, runId: handle.id, jobId, fingerprint: resolved.workFingerprint });
  if (kind === "cv") await updateApplicationCvRun(jobId, requestId, { runId: handle.id, status: "queued" });
  else await mutateJob(jobId, current => current[field]?.requestId === requestId && active(current[field])
    ? { [field]: { ...current[field], runId: handle.id, status: "queued" } } : undefined);
}

// Status changes have already been saved. Surface a dispatch failure separately
// so the UI does not roll back a successful move or hide the failed automation.
export async function reviewingGenerationResult(job, options) {
  try {
    await ensureReviewingGeneration(job.id, options);
    return { job: await getJob(job.id) || job, generationErrors: [] };
  } catch (error) {
    // A follow-up dispatch/read outage must never turn a published analysis into
    // a failed task (and replay its paid model call).
    const latest = await getJob(job.id).catch(() => null);
    return { job: latest || job, generationErrors: [error.message || "Automatic generation could not start."] };
  }
}
