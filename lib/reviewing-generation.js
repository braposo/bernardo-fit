import { randomUUID } from "node:crypto";
import { idempotencyKeys, runs, tasks } from "@trigger.dev/sdk";
import { getJob, mutateJob } from "./store.js";
import { resolveGenerationReview } from "./generation-review.js";
import { saveRunReceipt } from "./run-receipts.js";
import { ANALYSIS_TASK_ID, COVER_TASK_ID, TERMINAL_RUN_STATUSES, assertStorageDispatch, coverDispatchEnabled } from "./task-policy.js";

const active = run => ["dispatching", "queued"].includes(run?.status);
const hasCover = job => !!job.coverLetterId || (Array.isArray(job.coverLetter) && job.coverLetter.length > 0);

// Moving a role to Reviewing authorizes these two missing documents. Explicit
// rewrites continue to require the normal generation review. The analysis worker
// calls this again after publishing, because a cover letter needs that report.
export async function ensureReviewingGeneration(jobId) {
  let job = await getJob(jobId);
  if (!job || job.stage !== "reviewing" || job.archived) return;
  const kind = !job.fitReportId ? "analyse" : !hasCover(job) ? "cover" : null;
  if (!kind) return;
  const field = kind === "analyse" ? "analysisRun" : "coverRun";
  const prior = job[field];
  if (active(prior) && prior.runId) {
    const run = await runs.retrieve(prior.runId);
    if (!TERMINAL_RUN_STATUSES.has(run.status)) return;
    await mutateJob(jobId, current => current[field]?.requestId === prior.requestId && active(current[field])
      ? { [field]: { ...current[field], status: run.status === "COMPLETED" ? "completed" : "failed", finishedAt: new Date().toISOString() } } : undefined);
    job = await getJob(jobId);
    if (!job || job.stage !== "reviewing" || job.archived || (kind === "analyse" ? job.fitReportId : hasCover(job))) return;
  }
  assertStorageDispatch();
  if (kind === "cover" && !coverDispatchEnabled()) throw Object.assign(new Error("Automatic cover letter generation is temporarily paused."), { status: 503 });
  const resolved = await resolveGenerationReview({ kind, id: jobId });
  const pending = { requestId: "reviewing_" + randomUUID(), runId: "", model: resolved.model,
    fingerprint: resolved.workFingerprint, status: "dispatching", startedAt: new Date().toISOString(), finishedAt: "" };
  let selected;
  await mutateJob(jobId, current => {
    selected = undefined;
    if (current.stage !== "reviewing" || current.archived || (kind === "analyse" ? current.fitReportId : hasCover(current))) return;
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
  const handle = await tasks.trigger(kind === "analyse" ? ANALYSIS_TASK_ID : COVER_TASK_ID,
    { jobId, requestId, fingerprint: resolved.workFingerprint, ...resolved.payload,
      ...(kind === "cover" ? { origin: (process.env.PUBLIC_BASE_URL || "https://fit.bernardoraposo.com").replace(/\/$/, "") } : {}) },
    { idempotencyKey: key, idempotencyKeyTTL: "30d", tags: [`job:${jobId}`, `request:${requestId}`] });
  await saveRunReceipt({ kind, requestId, runId: handle.id, jobId, fingerprint: resolved.workFingerprint });
  await mutateJob(jobId, current => current[field]?.requestId === requestId && active(current[field])
    ? { [field]: { ...current[field], runId: handle.id, status: "queued" } } : undefined);
}

// Status changes have already been saved. Surface a dispatch failure separately
// so the UI does not roll back a successful move or hide the failed automation.
export async function reviewingGenerationResult(job) {
  try {
    await ensureReviewingGeneration(job.id);
    return { job: await getJob(job.id) || job, generationErrors: [] };
  } catch (error) {
    // A follow-up dispatch/read outage must never turn a published analysis into
    // a failed task (and replay its paid model call).
    const latest = await getJob(job.id).catch(() => null);
    return { job: latest || job, generationErrors: [error.message || "Automatic generation could not start."] };
  }
}
