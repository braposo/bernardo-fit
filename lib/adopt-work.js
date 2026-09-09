import { createHash } from "node:crypto";
import { createJobIfAbsent, findUnlinkedReportIds, getReport, listJobs } from "./store.js";

const jobIdForReport = (reportId) => "adp_" + createHash("sha256").update(String(reportId)).digest("hex").slice(0, 20);

export async function executeAdoptReports() {
  const jobs = await listJobs({ includeArchived: true });
  const ids = await findUnlinkedReportIds(jobs);
  let added = 0;
  const addedRows = [];
  for (const reportId of ids) {
    const report = await getReport(reportId);
    if (!report) continue;
    const row = await createJobIfAbsent(jobIdForReport(reportId), {
      company: report.company || "", role: report.job_title || "Untitled role",
      source: "Analysed on the website", sourceType: "website",
      jobDescription: report.job_description || "", fitReportId: reportId,
      stage: "new", receivedAt: report.created_at || new Date().toISOString(),
    });
    if (!jobs.some((job) => job.id === row.id)) {
      jobs.push(row); added++;
      addedRows.push({ id: row.id, company: row.company, role: row.role });
    }
  }
  return { outcome: "completed", added, addedRows };
}
