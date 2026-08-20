import { requireAdmin } from "../_admin.js";
import {
  getJob,
  getReport,
  updateJob,
  listReportVersions,
  activateReportVersion,
} from "../_store.js";

// GET  /api/admin/versions?id=<jobId>          list both kinds for one row
// POST /api/admin/versions { id, kind, vid }   make one of them live
//
// Fetched on demand rather than folded into the jobs list, which would mean an
// extra read per row on every page load to serve something usually unopened.
//
// The full report and letter bodies are deliberately left out of the listing.
// A row can hold several of each, and sending them all just to render a few
// dates would be a large response for nothing.
function meta(v, kind) {
  return kind === "fit"
    ? { vid: v.vid, at: v.createdAt, model: v.model || "", active: !!v.active, score: v.internal ? v.internal.score : null }
    : { vid: v.vid, at: v.at, model: v.model || "", active: !!v.active, words: v.words || 0 };
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === "GET") {
      const { id } = req.query || {};
      if (!id) {
        res.status(400).json({ error: "Missing id" });
        return;
      }
      const job = await getJob(id);
      if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
      }
      let fit = job.fitReportId ? await listReportVersions(job.fitReportId) : [];
      // Analyses generated before versioning existed have no version list.
      // Rather than show an empty panel next to a live report, describe the
      // live one. There is nothing to switch to, so it needs no vid.
      if (!fit.length && job.fitReportId) {
        const live = await getReport(job.fitReportId);
        if (live) {
          fit = [{
            vid: "",
            createdAt: live.regenerated_at || live.created_at || "",
            model: live.model || "",
            active: true,
            internal: job.score != null ? { score: job.score } : null,
          }];
        }
      }
      res.status(200).json({
        fit: fit.map((v) => meta(v, "fit")),
        letter: (job.coverLetterVersions || []).map((v) => meta(v, "letter")),
      });
      return;
    }

    if (req.method === "POST") {
      const { id, kind, vid } = req.body || {};
      if (!id || !vid || (kind !== "fit" && kind !== "letter")) {
        res.status(400).json({ error: "Missing id, vid, or kind" });
        return;
      }
      const job = await getJob(id);
      if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
      }

      if (kind === "fit") {
        if (!job.fitReportId) {
          res.status(409).json({ error: "No analysis for this role yet." });
          return;
        }
        const report = await activateReportVersion(job.fitReportId, vid);
        if (!report) {
          res.status(404).json({ error: "Version not found" });
          return;
        }
        // The row's score belongs to whichever analysis is live, so move it back
        // with the version. Older versions saved before scores were snapshotted
        // have none, and the row keeps what it had rather than being blanked.
        const versions = await listReportVersions(job.fitReportId);
        const chosen = versions.find((v) => v.vid === vid);
        if (chosen && chosen.internal) {
          await updateJob(id, {
            score: chosen.internal.score,
            tier: chosen.internal.tier,
            scoreBreakdown: chosen.internal.breakdown,
            rationale: chosen.internal.reasoning,
          });
        }
        res.status(200).json({ ok: true, kind, vid });
        return;
      }

      const versions = job.coverLetterVersions || [];
      const chosen = versions.find((v) => v.vid === vid);
      if (!chosen) {
        res.status(404).json({ error: "Version not found" });
        return;
      }
      await updateJob(id, {
        coverLetter: chosen.paragraphs,
        coverLetterAt: chosen.at,
        coverLetterModel: chosen.model,
        coverLetterVersions: versions.map((v) => ({ ...v, active: v.vid === vid })),
      });
      res.status(200).json({ ok: true, kind, vid });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 300) });
  }
}
