import { requireAdmin } from "../_admin.js";
import { resolveModel, DEFAULT_MODEL } from "../_models.js";
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
async function analyseJob(job, model) {
  const jd = (job.jobDescription || "").trim();
  if (jd.length < 20) return { id: job.id, skipped: "no job description" };

  // Only reuse a cached analysis when there is no per-role steer. Otherwise
  // the instructions would be silently ignored in favour of an older run.
  const instructions = (job.instructions || "").trim();
  const wanted = resolveModel(model);
  // A cached report came from whichever model wrote it. Asking for a different
  // one has to mean a fresh run, or the comparison is meaningless.
  const reusable = instructions ? null : await findReportByHash(jd);
  // findReportByHash returns { id, report }, so the model lives one level
  // down. Reports written before models were selectable carry no model field;
  // they came from the default, so treat them as such rather than re-running.
  const wroteBy = reusable ? reusable.report.model || DEFAULT_MODEL : "";
  const cached = reusable && wroteBy === wanted ? reusable : null;
  if (cached) {
    // Reusing a report means no fresh scoring; leave whatever the row already has.
    await updateJob(job.id, { fitReportId: cached.id });
    return { id: job.id, reportId: cached.id, cached: true };
  }

  const { report, internal } = await runAnalysis(jd, { instructions, model: wanted });
  report.job_description = jd;
  report.created_at = new Date().toISOString();
  report.model = wanted;
  const reportId = await saveReport(report, internal);
  await updateJob(job.id, {
    fitReportId: reportId,
    // Scoring is a product of the analysis and lives only on the row.
    ...(internal
      ? { score: internal.score, tier: internal.tier, scoreBreakdown: internal.breakdown, rationale: internal.reasoning }
      : {}),
  });
  return { id: job.id, reportId, cached: false, scored: !!internal, model: wanted };
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { id, all, model } = req.body || {};

  try {
    if (all) {
      const pending = (await listJobs()).filter(
        (j) => !j.fitReportId && (j.jobDescription || "").trim().length >= 20
      );
      const results = [];
      let failed = 0;
      for (const job of pending) {
        try {
          results.push(await analyseJob(job, model));
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
    const out = await analyseJob(job, model);
    if (out.skipped) {
      res.status(400).json({ error: "Add a fuller job description first." });
      return;
    }
    res.status(200).json(out);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Unexpected error", detail: err.detail });
  }
}
