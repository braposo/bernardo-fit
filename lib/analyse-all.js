import { createHash } from "node:crypto";

export const analysisChildRequestId = (parent, jobId) =>
  `${String(parent).slice(0, 70)}-${createHash("sha256").update(String(jobId)).digest("hex").slice(0, 16)}`;

export function summariseAnalysisBatch(jobs, runs) {
  const failures = [];
  let analysed = 0, cached = 0, superseded = 0;
  runs.forEach((run, index) => {
    if (run.ok && run.output?.outcome === "completed") {
      analysed++; if (run.output.cached) cached++;
    } else if (run.ok && run.output?.outcome === "superseded") superseded++;
    else failures.push({ id: jobs[index]?.id || "", company: jobs[index]?.company || "",
      role: jobs[index]?.role || "", error: String(run.error?.message || "Analysis failed").slice(0, 160) });
  });
  return { outcome: "completed", pending: jobs.length, analysed, cached, superseded,
    failed: failures.length, failures };
}
