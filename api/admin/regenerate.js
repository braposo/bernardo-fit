import { requireAdmin } from "../_admin.js";
import { runAnalysis } from "../_analyze.js";
import { getReport, overwriteReport, listJobs, updateJob } from "../_store.js";

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

    // Pick up any per-role steer from the row that owns this report.
    const owner = (await listJobs({ includeArchived: true })).find((j) => j.fitReportId === id);
    const instructions = owner ? (owner.instructions || "").trim() : "";

    let report, internal;
    try {
      ({ report, internal } = await runAnalysis(existing.job_description, { instructions }));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, detail: err.detail });
      return;
    }

    report.job_description = existing.job_description;
    report.created_at = existing.created_at;
    report.regenerated_at = new Date().toISOString();

    await overwriteReport(id, report);

    // Regenerating rescores, so push the new numbers onto whichever row owns
    // this report. Scores never travel with the report itself.
    if (internal) {
      if (owner) {
        await updateJob(owner.id, {
          score: internal.score,
          tier: internal.tier,
          scoreBreakdown: internal.breakdown,
          rationale: internal.reasoning,
        });
      }
    }

    res.status(200).json({ id, report, rescored: !!internal });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 300) });
  }
}
