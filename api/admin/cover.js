import { requireAdmin, makeViewToken } from "../_admin.js";
import { runCoverLetter } from "../_cover.js";
import { getJob, updateJob, getReport } from "../_store.js";

// POST /api/admin/cover  { id }
//
// Generates a cover letter for a pipeline row from its fit analysis, saves it
// on the row, and returns a short-lived token so the admin page can open the
// printable letter in a new tab without carrying the admin secret across.
export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { id, tokenOnly } = req.body || {};
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }

  try {
    const job = await getJob(id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (!job.fitReportId) {
      res.status(409).json({ error: "Generate the fit analysis first; the letter is written from it." });
      return;
    }
    // Reopening an existing letter just needs a fresh token, not a rewrite.
    if (tokenOnly) {
      if (!job.coverLetter) {
        res.status(404).json({ error: "No cover letter for this role yet." });
        return;
      }
      res.status(200).json({ ok: true, token: makeViewToken(id) });
      return;
    }

    const report = await getReport(job.fitReportId);
    if (!report) {
      res.status(409).json({ error: "The linked fit analysis is missing. Regenerate it first." });
      return;
    }

    const origin = "https://" + (req.headers["x-forwarded-host"] || req.headers.host || "fit.bernardoraposo.com");
    const letter = await runCoverLetter({
      report,
      fitUrl: `${origin}/?r=${encodeURIComponent(job.fitReportId)}`,
    });

    await updateJob(id, { coverLetter: letter.paragraphs, coverLetterAt: letter.generatedAt });

    res.status(200).json({
      ok: true,
      words: letter.words,
      salutation: letter.salutation,
      token: makeViewToken(id),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Unexpected error", detail: err.detail });
  }
}
