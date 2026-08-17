import { requireAdmin } from "../_admin.js";
import {
  listJobs,
  saveJob,
  updateJob,
  deleteJob,
  findExistingJob,
  findUnlinkedReportIds,
  getReport,
  getStats,
  JOB_STAGES,
} from "../_store.js";
import { INBOX_OPPORTUNITIES, INBOX_SCAN_META } from "../_inbox-scan.js";

// GET    /api/admin/jobs              -> { jobs, stages }   (jobs carry .stats)
// POST   /api/admin/jobs              -> create one, or { action: "import" }
// PATCH  /api/admin/jobs?id=abc       -> partial update (stage, notes, fitReportId, ...)
// DELETE /api/admin/jobs?id=abc       -> remove
export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === "GET") {
      const jobs = await listJobs();
      // Attach view/interaction counts for any job with a linked fit report.
      const ids = jobs.map((j) => j.fitReportId).filter(Boolean);
      const stats = ids.length ? await getStats(ids) : {};
      res.status(200).json({
        jobs: jobs.map((j) => ({ ...j, stats: j.fitReportId ? stats[j.fitReportId] || null : null })),
        stages: JOB_STAGES,
        scan: INBOX_SCAN_META,
        unlinked: (await findUnlinkedReportIds()).length,
      });
      return;
    }

    if (req.method === "POST") {
      const body = req.body || {};

      if (body.action === "import") {
        let added = 0;
        let updated = 0;
        for (const opp of INBOX_OPPORTUNITIES) {
          const existing = await findExistingJob(opp);
          if (existing) {
            // Refresh the scan-derived metadata, but never touch anything the
            // user owns: stage, notes, and any linked fit report stay as they are.
            await updateJob(existing.id, {
              ...opp,
              stage: existing.stage,
              notes: existing.notes,
              fitReportId: existing.fitReportId,
              createdAt: existing.createdAt,
            });
            updated++;
          } else {
            await saveJob(opp);
            added++;
          }
        }
        res.status(200).json({ added, updated, total: INBOX_OPPORTUNITIES.length });
        return;
      }

      // Pull analyses that predate the auto-linking into the pipeline.
      if (body.action === "adopt") {
        const ids = await findUnlinkedReportIds();
        let added = 0;
        for (const rid of ids) {
          const r = await getReport(rid);
          if (!r) continue;
          await saveJob({
            company: r.company || "",
            role: r.job_title || "Untitled role",
            source: "Analysed on the website",
            sourceType: "website",
            jobDescription: r.job_description || "",
            fitReportId: rid,
            stage: "new",
            receivedAt: r.created_at || new Date().toISOString(),
          });
          added++;
        }
        res.status(200).json({ added });
        return;
      }

      if (!body.company && !body.role) {
        res.status(400).json({ error: "Need at least a company or a role." });
        return;
      }
      const job = await saveJob(body);
      res.status(200).json({ job });
      return;
    }

    if (req.method === "PATCH") {
      const { id } = req.query || {};
      if (!id) {
        res.status(400).json({ error: "Missing id" });
        return;
      }
      if (req.body && req.body.stage && !JOB_STAGES.includes(req.body.stage)) {
        res.status(400).json({ error: "Unknown stage" });
        return;
      }
      const job = await updateJob(id, req.body || {});
      if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
      }
      res.status(200).json({ job });
      return;
    }

    if (req.method === "DELETE") {
      const { id } = req.query || {};
      if (!id) {
        res.status(400).json({ error: "Missing id" });
        return;
      }
      const ok = await deleteJob(id);
      if (!ok) {
        res.status(404).json({ error: "Job not found" });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 300) });
  }
}
