import { requireAdmin } from "../_admin.js";
import { listReports, deleteReport, listJobs, listReportVersions } from "../_store.js";

// GET    /api/admin/reports?offset=&limit=   -> { reports, total }
// GET    /api/admin/reports?export=1         -> everything, as one document
//
// The export lives here rather than in its own file because Vercel counts
// every route as a serverless function and the plan allows twelve. Adding a
// thirteenth built fine and then failed to deploy. This endpoint was already
// unreachable from the admin page, so it had room.
// DELETE /api/admin/reports?id=abc123        -> { ok: true }
export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  if (req.method === "GET" && req.query && req.query.export === "1") {
    // The whole pipeline lives in one Redis instance with no other copy. This
    // is the way out: rows, reports, and every stored version, in a shape that
    // can be read without this app existing.
    try {
      const jobs = await listJobs({ includeArchived: true });

      // Reports are paged, so walk until they run out rather than assume a
      // ceiling a long search would quietly exceed.
      const all = [];
      for (let o = 0; ; o += 100) {
        const page = await listReports({ offset: o, limit: 100 });
        all.push(...page.reports);
        if (all.length >= page.total || !page.reports.length) break;
      }

      const versions = {};
      for (const r of all) {
        const v = await listReportVersions(r.id);
        if (v.length) versions[r.id] = v;
      }

      // Scores, notes and instructions are all in here. Admin only, and it
      // should not sit in a cache on the way to the browser.
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", 'attachment; filename="bernardo-fit-' + new Date().toISOString().slice(0, 10) + '.json"');
      res.status(200).json({
        exportedAt: new Date().toISOString(),
        counts: { jobs: jobs.length, reports: all.length, versioned: Object.keys(versions).length },
        jobs,
        reports: all,
        versions,
      });
    } catch (err) {
      res.status(500).json({ error: "Export failed", detail: String(err).slice(0, 300) });
    }
    return;
  }

  if (req.method === "GET") {
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    try {
      const { reports, total } = await listReports({ offset, limit });
      res.status(200).json({ reports, total });
    } catch (err) {
      res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 300) });
    }
    return;
  }

  if (req.method === "DELETE") {
    const { id } = req.query || {};
    if (!id) {
      res.status(400).json({ error: "Missing id" });
      return;
    }
    try {
      const ok = await deleteReport(id);
      if (!ok) {
        res.status(404).json({ error: "Report not found" });
        return;
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 300) });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
