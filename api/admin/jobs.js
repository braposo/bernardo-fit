import { requireAdmin } from "../_admin.js";
import {
  listJobs,
  getJob,
  saveJob,
  updateJob,
  deleteJob,
  findExistingJob,
  findUnlinkedReportIds,
  countArchivedJobs,
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
      const onlyArchived = req.query && req.query.archived === "1";
      const jobs = await listJobs({ onlyArchived });
      // Attach view/interaction counts for any job with a linked fit report.
      const ids = jobs.map((j) => j.fitReportId).filter(Boolean);
      const stats = ids.length ? await getStats(ids) : {};
      res.status(200).json({
        jobs: jobs.map((j) => ({ ...j, stats: j.fitReportId ? stats[j.fitReportId] || null : null })),
        stages: JOB_STAGES,
        scan: INBOX_SCAN_META,
        unlinked: (await findUnlinkedReportIds()).length,
        archivedCount: await countArchivedJobs(),
        viewingArchived: onlyArchived,
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
              // Filing something away is a decision; a re-import shouldn't undo it.
              archived: existing.archived,
              archivedAt: existing.archivedAt,
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
      const patch = req.body || {};
      if (patch.stage && !JOB_STAGES.includes(patch.stage)) {
        res.status(400).json({ error: "Unknown stage" });
        return;
      }
      // Archiving stamps the time; restoring clears it.
      if (patch.archived === true) patch.archivedAt = new Date().toISOString();
      if (patch.archived === false) patch.archivedAt = "";
      const job = await updateJob(id, patch);
      if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
      }
      res.status(200).json({ job });
      return;
    }

    // Delete is only allowed once a row is archived, so removal is always a
    // second, deliberate step rather than one misplaced click. The fit report
    // itself is left alone: any link already shared keeps resolving.
    if (req.method === "DELETE") {
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
      if (!job.archived) {
        res.status(409).json({ error: "Archive this row before deleting it." });
        return;
      }
      await deleteJob(id);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 300) });
  }
}
