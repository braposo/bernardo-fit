import { listJobs, mutateJob } from "./store.js";

export async function applyAnalysisToOwners(reportId, internal, { attachJobId = "", requestId = "" } = {}) {
  const jobs = await listJobs({ includeArchived: true });
  const owners = jobs.filter((job) => job.fitReportId === reportId || job.id === attachJobId);
  for (const owner of owners) {
    await mutateJob(owner.id, (current) => {
      const attaching = current.id === attachJobId && current.fitReportId !== reportId;
      if (attaching && requestId && current.analysisRun?.requestId !== requestId) return undefined;
      return {
        ...(attaching ? { fitReportId: reportId } : {}),
        briefFingerprint: "",
        ...(internal ? {
          score: internal.score, tier: internal.tier, scoreBreakdown: internal.breakdown, rationale: internal.reasoning,
        } : {}),
        ...(current.id === attachJobId && current.analysisRun?.requestId === requestId ? {
          analysisRun: { ...current.analysisRun, status: "completed", finishedAt: new Date().toISOString() },
        } : {}),
      };
    });
  }
  return owners.map((job) => job.id);
}
