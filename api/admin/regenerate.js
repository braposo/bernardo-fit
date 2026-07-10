import { requireAdmin } from "../_admin.js";
import { runAnalysis } from "../_analyze.js";
import { getReport, overwriteReport } from "../_store.js";

// POST /api/admin/regenerate  { id }
// Re-runs the analysis for an existing report's stored job description and
// overwrites it in place — same id, same permalink, fresh content.
export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { id } = req.body || {};
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }

  try {
    const existing = await getReport(id);
    if (!existing || !existing.job_description) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    let report;
    try {
      report = await runAnalysis(existing.job_description);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, detail: err.detail });
      return;
    }

    report.job_description = existing.job_description;
    report.created_at = existing.created_at;
    report.regenerated_at = new Date().toISOString();

    await overwriteReport(id, report);
    res.status(200).json({ id, report });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 300) });
  }
}
