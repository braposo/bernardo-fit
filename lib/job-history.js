import { getJobAudit, auditEvent } from "./job-audit.js";
import { getReport, listReportVersions } from "./store.js";
import { listCoverVersions } from "./cover-artifacts.js";
import { listScreenArtifacts } from "./screen-artifacts.js";

// Workers deploy separately from the app. Retained versions are reliable evidence
// of generation even when the worker that wrote them predates audit recording.
// Never infer a publication timestamp from the currently active version.
export async function getJobHistory(job, options = {}) {
  const reports = [...new Set([...(job.auditReportIds || []), job.fitReportId].filter(Boolean))];
  const [fitGroups, letters, research, briefs] = await Promise.all([
    Promise.all(reports.map(async id => {
      const versions = await listReportVersions(id);
      if (versions.length) return versions;
      const report = await getReport(id);
      return report ? [{ vid: id, createdAt: report.regenerated_at || report.created_at, model: report.model }] : [];
    })), listCoverVersions(job, { preserveMissingDates: true }), listScreenArtifacts(job.id, "research"), listScreenArtifacts(job.id, "brief"),
  ]);
  const evidence = [];
  const add = (type, title, detail, id, at) => {
    if (at && Number.isFinite(Date.parse(at))) evidence.push(auditEvent(type, title, detail, { id, at }));
  };
  for (const v of fitGroups.flat()) add("document.generated", "Fit analysis generated", [v.model, v.vid].filter(Boolean).join(" · "), `fit-${v.vid}`, v.createdAt);
  for (const v of letters) add("document.generated", "Cover letter version saved", [v.model, v.vid].filter(Boolean).join(" · "), `cover-${v.vid}`, v.at);
  for (const [kind, title, versions] of [["research", "Company research", research], ["brief", "Interview brief", briefs]]) {
    for (const v of versions) add("document.generated", `${title} version saved`, [v.model, v.id].filter(Boolean).join(" · "), `${kind}-${v.id}`, v.at);
  }
  for (const [field, title] of [["jevRun", "Fit assessment"], ["analysisRun", "Fit analysis"], ["coverRun", "Cover letter"], ["researchRun", "Company research"], ["briefRun", "Interview brief"], ["prepareRun", "Interview preparation"]]) {
    const run = job[field];
    if (run?.finishedAt) add(`generation.${run.status}`, `${title}: ${run.status}`, [run.model, run.runId].filter(Boolean).join(" · "), `run-${run.requestId}-${run.status}`, run.finishedAt);
  }
  for (const q of job.questions || []) {
    if (q.answeredAt) add("answer.generated", "Application answer generated", q.model || "", `answer-${q.id}-${q.answeredAt}`, q.answeredAt);
  }
  return getJobAudit(job, { ...options, evidence });
}
