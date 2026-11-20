import { getJob, mutateJob } from "./store.js";
import { assessFit, scoringFingerprint } from "./jev-scoring.js";
import { getTaskResult, saveTaskResult } from "./task-results.js";
import { summariseOverview } from "./overview-summary.js";

export async function executeJevWork({ jobId, requestId, fingerprint }) {
  const job = await getJob(jobId);
  if (!job) throw Object.assign(new Error("Job not found"), { status: 404, abort: true });
  const matches = current => current && !current.archived && current.jevRun?.requestId === requestId && scoringFingerprint(current) === fingerprint;
  let assessment, overviewSummary;
  if (matches(job)) {
    assessment = await getTaskResult("jev-score", jobId, requestId);
    if (!assessment) assessment = await saveTaskResult("jev-score", jobId, requestId, await assessFit(job, requestId));
    // Checkpoint each paid step separately so a summary retry reuses the scores.
    // Recheck ownership before spending on prose if inputs changed during scoring.
    if (matches(await getJob(jobId))) {
      overviewSummary = await getTaskResult("overview-summary", jobId, requestId);
      if (!overviewSummary) overviewSummary = await saveTaskResult("overview-summary", jobId, requestId,
        await summariseOverview(job, assessment, requestId));
    }
  }
  let outcome = "superseded";
  await mutateJob(jobId, current => {
    if (current.jevRun?.requestId !== requestId) return undefined;
    outcome = assessment && overviewSummary && matches(current) ? "completed" : "superseded";
    return { ...(outcome === "completed" ? { jevAssessment: assessment, overviewSummary } : {}),
      jevRun: { ...current.jevRun, status: outcome, finishedAt: new Date().toISOString() } };
  });
  return { outcome, jobId, requestId };
}
