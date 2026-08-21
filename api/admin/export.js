import { requireAdmin } from "../_admin.js";
import { listJobs, listReports, listReportVersions } from "../_store.js";

// GET /api/admin/export -> everything, as one JSON document
//
// The whole pipeline lives in a single Redis instance with no other copy. This
// is the way out: rows, reports, and every stored version, in a shape that can
// be read without this app existing.
//
// Deliberately not paginated. The point is a complete snapshot, and the data is
// small enough that splitting it would only create the chance of a partial one.
export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const jobs = await listJobs({ includeArchived: true });

    // Reports are paged, so walk until the pages run out rather than assuming
    // a ceiling that a long search would quietly exceed.
    const reports = [];
    for (let offset = 0; ; offset += 100) {
      const page = await listReports({ offset, limit: 100 });
      reports.push(...page.reports);
      if (reports.length >= page.total || !page.reports.length) break;
    }

    // Versions hang off reports rather than being indexed, so collect them by id.
    const versions = {};
    for (const r of reports) {
      const v = await listReportVersions(r.id);
      if (v.length) versions[r.id] = v;
    }

    const body = {
      exportedAt: new Date().toISOString(),
      counts: {
        jobs: jobs.length,
        reports: reports.length,
        versioned: Object.keys(versions).length,
      },
      jobs,
      reports,
      versions,
    };

    // Scores, notes and instructions are all in here. It is admin-only and
    // ought to stay out of any cache between here and the browser.
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="bernardo-fit-' + new Date().toISOString().slice(0, 10) + '.json"'
    );
    res.status(200).json(body);
  } catch (err) {
    res.status(500).json({ error: "Export failed", detail: String(err).slice(0, 300) });
  }
}
