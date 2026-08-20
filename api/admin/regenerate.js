import { requireAdmin } from "../_admin.js";
import { resolveModel } from "../_models.js";
import { runAnalysis } from "../_analyze.js";
import { getReport, overwriteReport, addReportVersion, listJobs, updateJob } from "../_store.js";

// POST /api/admin/regenerate  { id }
// Re-runs the analysis for an existing report's stored job description and
// overwrites it in place — same id, same permalink, fresh content.
export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // jobId is optional and says which row asked. It matters because dedup can
  // point several rows at one report, and only one of them holds the
  // instructions this regenerate is meant to honour.
  const { id, jobId, model } = req.body || {};
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

    // Every row pointing at this report shares the analysis, so they all get
    // rescored. Which one supplies the instructions is a different question.
    const owners = (await listJobs({ includeArchived: true })).filter((j) => j.fitReportId === id);
    const asked = jobId ? owners.find((j) => j.id === jobId) : null;
    // Prefer the row that asked. Failing that, prefer one that actually has
    // instructions, so a steered row is not silently ignored in favour of a
    // bare duplicate. List order is not stable enough to rely on.
    const owner = asked || owners.find((j) => (j.instructions || "").trim()) || owners[0] || null;
    const instructions = owner ? (owner.instructions || "").trim() : "";

    let report, internal;
    try {
      ({ report, internal } = await runAnalysis(existing.job_description, { instructions, model: resolveModel(model) }));
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, detail: err.detail });
      return;
    }

    report.job_description = existing.job_description;
    report.created_at = existing.created_at;
    report.regenerated_at = new Date().toISOString();
    report.model = resolveModel(model);

    await overwriteReport(id, report);
    // Keep the previous analysis rather than losing it, so a regeneration
    // that comes out worse can be undone.
    await addReportVersion(id, report, internal);

    // Regenerating rescores, so push the new numbers onto whichever row owns
    // this report. Scores never travel with the report itself.
    if (internal) {
      for (const row of owners) {
        await updateJob(row.id, {
          score: internal.score,
          tier: internal.tier,
          scoreBreakdown: internal.breakdown,
          rationale: internal.reasoning,
        });
      }
    }

    res.status(200).json({ id, report, rescored: !!internal, model: resolveModel(model) });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 300) });
  }
}
