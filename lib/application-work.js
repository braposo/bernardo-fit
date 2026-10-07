import { getJob, getReport, mutateJob } from "./store.js";
import { claimApplicationCvRun, getApplicationCv, updateApplicationCvRun } from "./application-cv-store.js";
import { resolveApplicationCvGeneration } from "./generation-review.js";

// An application is one fit analysis and the CV written from it. This run owns
// neither generation: it starts the fit-analysis child, then the CV child from
// the analysis it produced, so both halves share the version instructions and
// the CV's fit page shows the analysis it was tailored to.
const now = () => new Date().toISOString();
const childId = (requestId, part) => `${requestId.slice(0, 90)}-${part}`;

async function finish(jobId, requestId, status) {
  await mutateJob(jobId, (current) => current.applicationRun?.requestId === requestId &&
    !["completed", "superseded", "failed"].includes(current.applicationRun.status)
    ? { applicationRun: { ...current.applicationRun, status, finishedAt: now() } } : undefined);
}

// A CV run whose worker already finished can still read as active if nobody
// settled it. Settle it from Trigger's run state so it cannot block this one.
async function settleFinishedCvRun(jobId, ownRequestId) {
  const run = (await getApplicationCv(jobId))?.run;
  if (!run?.runId || run.requestId === ownRequestId || !["dispatching", "queued", "running"].includes(run.status)) return;
  const { runs } = await import("@trigger.dev/sdk");
  const prior = await runs.retrieve(run.runId).catch(() => null);
  if (!prior?.isCompleted) return;
  await updateApplicationCvRun(jobId, run.requestId, { status: prior.status === "COMPLETED" ? prior.output?.outcome || "completed" : "failed",
    finishedAt: now() }).catch(() => {});
}

async function settleAnalysisRun(jobId, requestId, status) {
  await mutateJob(jobId, (current) => current.analysisRun?.requestId === requestId &&
    ["dispatching", "queued"].includes(current.analysisRun.status)
    ? { analysisRun: { ...current.analysisRun, status, finishedAt: now() } } : undefined);
}

export async function executeApplicationWork(payload, { runId = "", runAnalysis, runCv, onPhase = () => {} }) {
  const { jobId, requestId, versionInstructions = "", origin } = payload;
  const job = await getJob(jobId);
  if (!job || job.applicationRun?.requestId !== requestId) return { outcome: "superseded", jobId, requestId };

  // The analysis worker checks that the role still points at its request.
  const fitRequestId = childId(requestId, "fit");
  await mutateJob(jobId, (current) => current.applicationRun?.requestId === requestId && current.analysisRun?.requestId !== fitRequestId
    ? { analysisRun: { requestId: fitRequestId, runId, model: payload.model, fingerprint: payload.analysisFingerprint,
      status: "queued", startedAt: now(), finishedAt: "" } } : undefined);
  onPhase("analysing");
  let analysis;
  try {
    analysis = await runAnalysis({ jobId, reportId: payload.reportId || undefined, requestId: fitRequestId,
      fingerprint: payload.analysisFingerprint, model: payload.model, mode: payload.mode, versionInstructions });
  } catch (error) {
    await settleAnalysisRun(jobId, fitRequestId, "failed");
    throw error;
  }
  if (analysis?.outcome !== "completed") {
    await finish(jobId, requestId, "superseded");
    return { outcome: "superseded", jobId, requestId, stage: "analysis" };
  }

  const latest = await getJob(jobId);
  if (!latest || latest.applicationRun?.requestId !== requestId) return { outcome: "superseded", jobId, requestId };
  const report = latest.fitReportId ? await getReport(latest.fitReportId) : null;
  const cv = await resolveApplicationCvGeneration(latest, report, versionInstructions);
  const cvRequestId = childId(requestId, "cv");
  await settleFinishedCvRun(jobId, cvRequestId);
  const claimed = (await claimApplicationCvRun(latest, { requestId: cvRequestId, runId, model: cv.model,
    fingerprint: cv.fingerprint, status: "queued", startedAt: now(), finishedAt: "" })).run;
  if (claimed?.requestId !== cvRequestId) {
    throw Object.assign(new Error("A CV is already being prepared for this role. Wait for it to finish, then generate again."),
      { status: 409, abort: true });
  }
  onPhase("writing");
  let result;
  try {
    result = await runCv({ ...cv.payload, jobId, requestId: cvRequestId, fingerprint: cv.fingerprint,
      versionInstructions, origin });
  } catch (error) {
    try {
      await updateApplicationCvRun(jobId, cvRequestId, { status: "failed", phase: "failed",
        error: error instanceof Error ? error.message.slice(0, 300) : "CV generation failed.", finishedAt: now() });
    } catch { /* a newer run owns the CV */ }
    throw error;
  }
  const outcome = result?.outcome === "completed" ? "completed" : "superseded";
  await finish(jobId, requestId, outcome);
  return { outcome, jobId, requestId, reportId: analysis.reportId, publication: result?.publication || "none",
    cvVersionId: result?.versionId || "" };
}
