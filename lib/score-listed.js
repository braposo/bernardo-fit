import { scoringFingerprint } from "./jev-scoring.js";

export function selectScoringCandidates(jobs, reviewed) {
  const byId = new Map(reviewed.map((item) => [item.id, item.fingerprint]));
  return jobs.filter((job) => {
    const fingerprint = byId.get(job.id);
    return !!fingerprint && !job.archived && fingerprint === scoringFingerprint(job);
  });
}

export function summariseScoringBatch(jobs, runs) {
  const failures = [];
  let assessed = 0, superseded = 0;
  runs.forEach((run, index) => {
    if (run.ok && run.output?.outcome === "completed") assessed++;
    else if (run.ok && run.output?.outcome === "superseded") superseded++;
    else failures.push({ id: jobs[index]?.id || "", company: jobs[index]?.company || "",
      role: jobs[index]?.role || "", error: String(run.error?.message || "Assessment failed").slice(0, 160) });
  });
  return { outcome: "completed", pending: jobs.length, assessed, superseded, failed: failures.length, failures };
}
