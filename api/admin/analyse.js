import { requireAdmin } from "../_admin.js";
import { runAnalysis } from "../_analyze.js";
import {
  listJobs,
  getJob,
  updateJob,
  saveReport,
  findReportByHash,
} from "../_store.js";

// POST /api/admin/analyse  { id }        analyse one pipeline row
// POST /api/admin/analyse  { all: true } analyse every row that has a job
//                                        description but no analysis yet
//
// This exists rather than reusing /api/analyze because that endpoint is rate
// limited to 10 per hour per IP to protect the bill from visitors. Running the
// whole pipeline would hit that wall immediately, and the limit is pointless
// here: the caller is already holding the admin secret. Dedup still applies, so
// a job description that has been analysed before costs nothing.
async function analyseJob(job) {
  const jd = (job.jobDescription || "").trim();
  if (jd.length < 20) return { id: job.id, skipped: "no job description" };

  const cached = await findReportByHash(jd);
  if (cached) {
    await updateJob(job.id, { fitReportId: cached.id });
    return { id: job.id, reportId: cached.id, cached: true };
  }

  const report = await runAnalysis(jd);
  report.job_description = jd;
  report.created_at = new Date().toISOString();
  const reportId = await saveReport(report);
  await updateJob(job.id, { fitReportId: reportId });
  return { id: job.id, reportId, cached: false };
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { id, all } = req.body || {};

  try {
    if (all) {
      const pending = (await listJobs()).filter(
        (j) => !j.fitReportId && (j.jobDescription || "").trim().length >= 20
      );
      const results = [];
      let failed = 0;
      for (const job of pending) {
        try {
          results.push(await analyseJob(job));
        } catch (err) {
          failed++;
          results.push({ id: job.id, error: String(err.message || err).slice(0, 120) });
        }
      }
      res.status(200).json({
        analysed: results.filter((r) => r.reportId).length,
        cached: results.filter((r) => r.cached).length,
        failed,
        pending: pending.length,
      });
      return;
    }

    if (!id) {
      res.status(400).json({ error: "Missing id" });
      return;
    }
    const job = await getJob(id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const out = await analyseJob(job);
    if (out.skipped) {
      res.status(400).json({ error: "Add a fuller job description first." });
      return;
    }
    res.status(200).json(out);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Unexpected error", detail: err.detail });
  }
}
