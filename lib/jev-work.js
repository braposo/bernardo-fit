import { getJob, mutateJob } from "./store.js";
import { assessFit, scoringFingerprint } from "./jev-scoring.js";
import { getTaskResult, saveTaskResult } from "./task-results.js";

export async function executeJevWork({ jobId, requestId, fingerprint }) {
  const job = await getJob(jobId);
  if (!job) throw Object.assign(new Error("Job not found"), { status: 404, abort: true });
  const matches = current => current && !current.archived && current.jevRun?.requestId === requestId && scoringFingerprint(current) === fingerprint;
  let assessment;
  if (matches(job)) {
    assessment = await getTaskResult("jev-score", jobId, requestId);
    if (!assessment) assessment = await saveTaskResult("jev-score", jobId, requestId, await assessFit(job, requestId));
  }
  let outcome = "superseded";
  await mutateJob(jobId, current => {
    if (current.jevRun?.requestId !== requestId) return undefined;
    outcome = assessment && matches(current) ? "completed" : "superseded";
    return { ...(outcome === "completed" ? { jevAssessment: assessment } : {}),
      jevRun: { ...current.jevRun, status: outcome, finishedAt: new Date().toISOString() } };
  });
  return { outcome, jobId, requestId };
}
