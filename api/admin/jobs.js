import { requireAdmin, makeViewToken } from "../../lib/admin.js";
import {
  listJobs,
  getJob,
  saveJob,
  updateJob,
  deleteJob,
  findExistingJob,
  findUnlinkedReportIds,
  getReport,
  getStats,
  JOB_STAGES,
  getReportSources,
  hashJD,
  editQuestion,
} from "../../lib/store.js";
import { jobSummary, jobDetail, matchesSearch } from "../../lib/job-view.js";
import { MODELS } from "../../lib/models.js";
import { deleteCoverArtifacts, getActiveCoverArtifact } from "../../lib/cover-artifacts.js";
import { deleteScreenArtifacts, getActiveBrief, getActiveResearch } from "../../lib/screen-artifacts.js";
import { coverDispatchEnabled, screenDispatchEnabled } from "../../lib/task-policy.js";

// GET    /api/admin/jobs              -> { jobs, stages }   (jobs carry .stats)
// POST   /api/admin/jobs              -> create one, or { action: "import" }
// PATCH  /api/admin/jobs?id=abc       -> partial update (stage, notes, fitReportId, ...)
// DELETE /api/admin/jobs?id=abc       -> remove
// Stages that take a row out of the pipeline by themselves.
const ARCHIVE_ON_STAGE = ["expired", "not_a_fit", "rejected"];

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  res.setHeader("Cache-Control", "private, no-store");

  try {
    if (req.method === "GET") {
      if (req.query?.id) {
        const job = await getJob(req.query.id);
        if (!job) return res.status(404).json({ error: "Job not found" });
        const sources = await getReportSources([job.fitReportId]);
        const source = sources[job.fitReportId];
        return res.status(200).json({ job: { ...jobDetail(job),
          jd: source ? { was: source.length, now: job.jobDescription.length, stale: hashJD(job.jobDescription) !== source.hash } : null,
        } });
      }
      const onlyArchived = req.query && req.query.archived === "1";
      const all = await listJobs({ includeArchived: true });
      const jobs = all.filter(j => !!j.archived === !!onlyArchived);
      if (req.query?.q !== undefined) {
        return res.status(200).json({ matchingIds: jobs.filter(j => matchesSearch(j, String(req.query.q).slice(0, 500))).map(j => j.id) });
      }
      // Attach view/interaction counts for any job with a linked fit report.
      const ids = jobs.map((j) => j.fitReportId).filter(Boolean);
      const [stats, analysed, unlinked] = await Promise.all([
        getStats(ids), getReportSources(ids), findUnlinkedReportIds(all),
      ]);
      // Whether the row's description has moved on since it was analysed.
      // Read from the report rather than stamped on the row when the analysis
      // runs: the report holds the exact text it was built from, so the answer
      // cannot drift out of step with reality however the row was edited.
      res.status(200).json({
        jobs: jobs.map((j) => ({
          ...jobSummary(j),
          stats: j.fitReportId ? stats[j.fitReportId] || null : null,
          jd: j.fitReportId && analysed[j.fitReportId] !== undefined
            ? { was: analysed[j.fitReportId].length, now: j.jobDescription.length, stale: hashJD(j.jobDescription) !== analysed[j.fitReportId].hash }
            : null,
        })),
        stages: JOB_STAGES,
        unlinked: unlinked.length,
        archivedCount: all.filter(j => j.archived).length,
        models: MODELS.map(({ id, label }) => ({ id, label })),
        archiveOnStage: ARCHIVE_ON_STAGE,
        features: { coverDispatchEnabled: coverDispatchEnabled(), screenDispatchEnabled: screenDispatchEnabled() },
        viewingArchived: onlyArchived,
      });
      return;
    }

    if (req.method === "POST") {
      const body = req.body || {};

      if (body.action === "letter-token") {
        const job = body.id ? await getJob(body.id) : null;
        if (!job || !(await getActiveCoverArtifact(job))) return res.status(404).json({ error: "No cover letter for this role yet." });
        return res.status(200).json({ token: makeViewToken(job.id) });
      }

      if (body.action === "artifact-token") {
        const job = body.id ? await getJob(body.id) : null;
        const artifact = body.kind === "research" ? await getActiveResearch(job) : await getActiveBrief(job);
        if (!job || !artifact) return res.status(404).json({ error: `No ${body.kind === "research" ? "research" : "screen brief"} for this role yet.` });
        return res.status(200).json({ token: makeViewToken(job.id) });
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
      res.status(200).json({ job: jobDetail(job) });
      return;
    }

    if (req.method === "PATCH") {
      const { id } = req.query || {};
      if (!id) {
        res.status(400).json({ error: "Missing id" });
        return;
      }
      const body = req.body || {};
      const EDITABLE = ["company", "role", "notes", "instructions", "jobDescription", "stage", "archived",
        "fitReportId", "location", "locationMode", "salary", "replyOwed", "userViewed", "closed", "sourceUrl"];
      const patch = Object.fromEntries(EDITABLE.filter(k => body[k] !== undefined).map(k => [k, body[k]]));
      if (["company", "role", "sourceUrl"].some((k) => body[k] !== undefined)) patch.researchFingerprint = "";
      if (["company", "role", "sourceUrl", "notes", "instructions", "jobDescription", "fitReportId", "location", "locationMode", "salary"].some((k) => body[k] !== undefined)) patch.briefFingerprint = "";
      if (body.questions !== undefined) {
        if (!Number.isInteger(body.revision)) return res.status(409).json({ error: "Edit one question at a time, or reload before replacing the question list." });
        patch.questions = body.questions;
      }
      if (patch.stage && !JOB_STAGES.includes(patch.stage)) {
        res.status(400).json({ error: "Unknown stage" });
        return;
      }
      // Both of these mean the role is done with, so it leaves the pipeline on
      // the same click rather than needing a second one. Done here rather than
      // in the page so it holds however the row is updated. An explicit archived
      // flag in the same patch still wins, so restoring one stays possible.
      if (ARCHIVE_ON_STAGE.includes(patch.stage) && patch.archived === undefined) {
        patch.archived = true;
      }
      // Archiving stamps the time; restoring clears it.
      if (patch.archived === true) patch.archivedAt = new Date().toISOString();
      if (patch.archived === false) patch.archivedAt = "";
      const job = body.question ? await editQuestion(id, body.question)
        : await updateJob(id, patch, { expectedRevision: body.questions !== undefined ? body.revision : undefined });
      if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
      }
      res.status(200).json({ job: { ...jobSummary(job),
        ...Object.fromEntries(Object.keys(patch).map(k => [k, job[k]])),
        ...(body.question ? { questions: job.questions } : {}),
      } });
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
      await deleteCoverArtifacts(id);
      await deleteScreenArtifacts(id);
      await deleteJob(id, { requireArchived: true });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Unexpected error", detail: String(err).slice(0, 300) });
  }
}
