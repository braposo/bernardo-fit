import { withSettingsHandler } from "../../lib/sanity/settings-handler.js";
import { requireAdmin, makeViewToken } from "../../lib/admin.js";
import {
  listJobs,
  getJob,
  saveJob,
  mutateJob,
  deleteJob,
  findExistingJob,
  findUnlinkedReportIds,
  getStats,
  JOB_STAGES,
  ARCHIVE_ON_STAGE,
  normaliseJobStage,
  getReportSources,
  hashJD,
  editQuestion,
} from "../../lib/store.js";
import { jobSummary, jobDetail, matchesSearch } from "../../lib/job-view.js";
import { MODELS, MODEL_LABELS } from "../../lib/models.js";
import { deleteCoverArtifacts, getActiveCoverArtifact } from "../../lib/cover-artifacts.js";
import { deleteScreenArtifacts, getActiveBrief, getActiveResearch } from "../../lib/screen-artifacts.js";
import { deleteTaskResults } from "../../lib/task-results.js";
import { coverDispatchEnabled, screenDispatchEnabled } from "../../lib/task-policy.js";
import { getActiveRuns } from "../../lib/run-receipts.js";
import { appendAudit, auditEvent } from "../../lib/job-audit.js";
import { getJobHistory } from "../../lib/job-history.js";
import { readJobUsage } from "../../lib/usage.js";
import { jevEnabled } from "../../lib/jev.js";
import { reviewingGenerationResult } from "../../lib/reviewing-generation.js";
import { getApplicationCvSummaries, getApplicationCv, markApplicationCvSubmitted } from "../../lib/application-cv-store.js";
import { applicationCvFields, withApplicationCvFields, generalCvFields } from "../../lib/application-cv-view.js";
import { listFilteredJobs, moveFilteredJob, clearFilteredJobs, filteredJobRetentionDays } from "../../lib/filtered-jobs.js";
import { startMovedJobCompletion } from "../../lib/filtered-job-enrich.js";
import { recordReviewDecision, reviewReasonOptions, validateDecisionInput } from "../../lib/review-decisions.js";
import { needsYouItems, needsYouResponse } from "../../lib/review-agent.js";
import { openProposalsForNeedsYou } from "../../lib/status-proposals.js";
import { routineHandler, listProposalsResponse, proposalAction } from "../../lib/handlers/status-proposals.js";
import { POSTING_ACTIONS, checkable, postingActionPatch, requestPostingCheck } from "../../lib/posting-check.js";
import { postingCheckSettings } from "../../lib/sanity/analysis-settings.js";

async function cvFields(job) {
  const { hasCv, cvRun, applicationFitUrl, applicationCv, generalCv } = await withApplicationCvFields(job);
  return { hasCv, cvRun, applicationFitUrl, applicationCv, generalCv };
}
async function cvWriteFields(job, errors) {
  try { return await cvFields(job); }
  catch { errors.push('The role was saved, but its CV status could not be refreshed. Reload to check it.'); return {}; }
}

// GET    /api/admin/jobs              -> { jobs, stages }   (jobs carry .stats)
// GET    /api/admin/jobs?filtered=1   -> { filtered, listedAt } (screened out, not moved or cleared)
// GET    /api/admin/jobs?reviewReasons=1 -> { advance, drop } (published quick picks, then learned ones)
// GET    /api/admin/jobs?needsYou=1   -> { items, agreement } (New jobs with a review agent suggestion,
//                                        then Reviewing jobs with posting gaps or form answers to approve,
//                                        then open email status proposals with kind "status-proposal")
// GET    /api/admin/jobs?proposals=1  -> { proposals } (email status proposals; lib/handlers/status-proposals.js)
// POST   /api/admin/jobs              -> create one, or { action: "import" }
// POST   { action: "apply-proposal" | "dismiss-proposal" | "timeline-add" | "timeline-edit" | "timeline-remove" }
// POST   { action: "dismiss-gap" | "draft-gap-question" | "paste-questions" | "approve-answer" |
//          "skip-answer" | "rerun-posting-check", id, ... } -> posting check actions (docs/posting-check.md)
// PATCH  /api/admin/jobs?id=abc       -> partial update (stage, notes, fitReportId, ...); leaving New
//                                        records a reviewDecision, with optional decision { reasons, note }
// DELETE /api/admin/jobs?id=abc       -> remove
// ?routine=match|proposal is the daily email routine's endpoint, with its own secret.

async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  res.setHeader("Cache-Control", "private, no-store");

  try {
    if (req.method === "GET") {
      if (req.query?.reviewReasons === "1") return res.status(200).json(await reviewReasonOptions());
      // Archived jobs too: review items skip them, but an email can concern a closed role.
      if (req.query?.needsYou === "1") return res.status(200).json(await needsYouResponse(await listJobs({ includeArchived: true })));
      if (req.query?.proposals === "1") return res.status(200).json(await listProposalsResponse(req.query));
      if (req.query?.filtered === "1") {
        const listedAt = new Date().toISOString();
        return res.status(200).json({ filtered: await listFilteredJobs(), retentionDays: filteredJobRetentionDays(), listedAt });
      }
      if (req.query?.id) {
        const job = await getJob(req.query.id);
        if (!job) return res.status(404).json({ error: "Job not found" });
        if (req.query.activity === "1") {
          const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
          const snapshot = Math.min(Date.now(), Number(req.query.snapshot) || Date.now());
          if (!Number.isSafeInteger(offset) || offset > 100000 || !Number.isFinite(snapshot) || snapshot < 0) return res.status(400).json({ error: "Invalid activity page" });
          const reportIds = [...new Set([...(job.auditReportIds || []), job.fitReportId].filter(Boolean))];
          const [audit, usage, stats] = await Promise.all([getJobHistory(job, { offset, snapshot }), readJobUsage(job.id, reportIds), getStats(reportIds)]);
          const totals = Object.values(stats).reduce((sum, row) => ({ view: sum.view + row.view, copy_link: sum.copy_link + row.copy_link, cv_download: sum.cv_download + row.cv_download }), { view: 0, copy_link: 0, cv_download: 0 });
          return res.status(200).json({ ...audit, usage, stats: totals });
        }
        const sources = await getReportSources([job.fitReportId]);
        const source = sources[job.fitReportId];
        return res.status(200).json({ job: { ...jobDetail(job), ...await cvFields(job),
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
      const [stats, analysed, unlinked, activeRuns, applications, generalCv, proposals] = await Promise.all([
        getStats(ids), getReportSources(ids), findUnlinkedReportIds(all),
        getActiveRuns(["jev-score-all", "adopt"]),
        getApplicationCvSummaries(jobs.map(job => job.id)),
        generalCvFields(),
        openProposalsForNeedsYou(),
      ]);
      // Whether the row's description has moved on since it was analysed.
      // Read from the report rather than stamped on the row when the analysis
      // runs: the report holds the exact text it was built from, so the answer
      // cannot drift out of step with reality however the row was edited.
      res.status(200).json({
        jobs: jobs.map((j) => ({
          ...jobSummary(j),
          ...applicationCvFields(j, applications[j.id]),
          generalCv,
          stats: j.fitReportId ? stats[j.fitReportId] || null : null,
          jd: j.fitReportId && analysed[j.fitReportId] !== undefined
            ? { was: analysed[j.fitReportId].length, now: j.jobDescription.length, stale: hashJD(j.jobDescription) !== analysed[j.fitReportId].hash }
            : null,
        })),
        stages: JOB_STAGES,
        unlinked: unlinked.length,
        archivedCount: all.filter(j => j.archived).length,
        needsYouCount: needsYouItems(all, { proposals }).length,
        models: MODELS.map(({ id, label }) => ({ id, label })),
        modelLabels: MODEL_LABELS,
        archiveOnStage: ARCHIVE_ON_STAGE,
        features: { coverDispatchEnabled: coverDispatchEnabled(), screenDispatchEnabled: screenDispatchEnabled(), jevEnabled: jevEnabled() },
        viewingArchived: onlyArchived,
        activeRuns,
      });
      return;
    }

    if (req.method === "POST") {
      const body = req.body || {};

      if (body.action === "activity") {
        const labels = { listing_opened: "Original job listing opened", fit_link_copied: "Fit link copied by admin", answer_copied: "Application answer copied" };
        const job = body.id ? await getJob(body.id) : null;
        if (!job || !Object.hasOwn(labels, body.event)) return res.status(400).json({ error: "Invalid job activity" });
        await appendAudit("job", job.id, auditEvent("admin." + body.event, labels[body.event], "", { actor: "admin" }));
        return res.status(200).json({ ok: true });
      }

      // Moves a screened-out job into the pipeline at New. No AI work runs.
      if (body.action === "move-filtered") {
        if (typeof body.id !== "string" || !body.id) return res.status(400).json({ error: "Missing filtered job id" });
        const job = await moveFilteredJob(body.id);
        try { await appendAudit("job", job.id, auditEvent("admin.filtered_moved", "Moved from Filtered to the pipeline", "", { actor: "admin" })); }
        catch { console.warn("Moved a filtered job; its audit entry could not be written."); }
        // The move itself has succeeded; fetching details and assessing fit
        // follow in the background and can be retried with Assess fit.
        let completed = job, completionError = "";
        try { completed = await startMovedJobCompletion(job) || job; }
        catch (error) { completionError = error.message || "Could not start the fit assessment."; }
        return res.status(200).json({ job: jobSummary(completed), ...(completionError ? { completionError } : {}) });
      }

      // Empties Filtered up to when the list was loaded. Records stay hidden so
      // reposts of cleared jobs are still recognised.
      if (body.action === "clear-filtered") {
        if (typeof body.before !== "string" || !body.before) return res.status(400).json({ error: "Reload Filtered and try again." });
        return res.status(200).json(await clearFilteredJobs({ before: body.before }));
      }

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

      const proposalResult = await proposalAction(body, { changeJob: updateJobFromBody });
      if (proposalResult) return res.status(proposalResult.status).json(proposalResult.json);
      // Posting check: gaps and drafted form answers wait for Bernardo. Nothing
      // is ever submitted; an approved answer joins the job's questions.
      if (POSTING_ACTIONS.includes(body.action)) {
        if (typeof body.id !== "string" || !body.id) return res.status(400).json({ error: "Missing job id" });
        if (body.action === "rerun-posting-check") {
          if (!postingCheckSettings()?.enabled) return res.status(409).json({ error: "Turn on the posting check in Sanity first." });
          const job = await getJob(body.id);
          if (!job) return res.status(404).json({ error: "Job not found" });
          if (!checkable(job)) return res.status(409).json({ error: "Move the job to Reviewing to check its posting." });
          const result = await requestPostingCheck(job, { force: true });
          if (!result.requested) return res.status(502).json({ error: "The posting check could not be started. Try again." });
          return res.status(202).json({ requested: true, runId: result.runId });
        }
        const job = await mutateJob(body.id, current => postingActionPatch(current, body));
        if (!job) return res.status(404).json({ error: "Job not found" });
        // Pasted questions are drafted by a check run (only while the check is on).
        const requested = body.action === "paste-questions" ? (await requestPostingCheck(job)).requested : undefined;
        return res.status(200).json({ job: { ...jobSummary(job), questions: job.questions || [] },
          ...(requested !== undefined ? { requested } : {}) });
      }

      if (!body.company && !body.role) {
        res.status(400).json({ error: "Need at least a company or a role." });
        return;
      }
      const saved = await saveJob(body);
      const { job, generationErrors } = await reviewingGenerationResult(saved);
      res.status(200).json({ job: { ...jobDetail(job), ...await cvWriteFields(job, generationErrors) }, generationErrors });
      return;
    }

    if (req.method === "PATCH") {
      const { id } = req.query || {};
      if (!id) {
        res.status(400).json({ error: "Missing id" });
        return;
      }
      const { status, json } = await updateJobFromBody(id, req.body || {});
      return res.status(status).json(json);
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
      await deleteTaskResults(id);
      await deleteJob(id, { requireArchived: true });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Unexpected error", detail: String(err).slice(0, 300) });
  }
}

// The PATCH path, shared with applying an email status proposal so a proposed
// move has the same audit, archiving, review decision, Reviewing generation and
// CV submission as a manual one. extraPatch(current) adds fields to the same
// guarded write (the proposal's timeline entry and learned email ids).
// Returns { status, json }.
async function updateJobFromBody(id, body, { extraPatch } = {}) {
  const EDITABLE = ["company", "role", "notes", "instructions", "jobDescription", "stage", "archived",
    "fitReportId", "location", "locationMode", "salary", "replyOwed", "userViewed", "closed", "sourceUrl"];
  const patch = Object.fromEntries(EDITABLE.filter(k => body[k] !== undefined).map(k => [k, body[k]]));
  if (body.questions !== undefined) {
    if (!Number.isInteger(body.revision)) return { status: 409, json: { error: "Edit one question at a time, or reload before replacing the question list." } };
    patch.questions = body.questions;
  }
  if (patch.stage !== undefined) patch.stage = normaliseJobStage(patch.stage);
  if (patch.stage && !JOB_STAGES.includes(patch.stage)) return { status: 400, json: { error: "Unknown stage" } };
  let decision;
  try { decision = validateDecisionInput(body.decision); }
  catch (error) { return { status: 400, json: { error: error.message } }; }
  // Read inside the guarded write so a concurrent move cannot record twice.
  let previousStage;
  // Shared storage applies terminal-stage archiving and explicit restores.
  let job = body.question ? await editQuestion(id, body.question)
    : await mutateJob(id, current => {
      previousStage = normaliseJobStage(current.stage) || "new";
      const changed = key => body[key] !== undefined && JSON.stringify(body[key]) !== JSON.stringify(current[key] ?? "");
      const invalidation = {};
      if (["company", "role", "sourceUrl"].some(changed)) invalidation.researchFingerprint = "";
      if (["company", "role", "sourceUrl", "notes", "instructions", "jobDescription", "fitReportId", "location", "locationMode", "salary", "questions"].some(changed)) invalidation.briefFingerprint = "";
      return { ...patch, ...invalidation, ...(extraPatch ? extraPatch(current) : {}) };
    }, { expectedRevision: body.questions !== undefined ? body.revision : undefined });
  if (!job) return { status: 404, json: { error: "Job not found" } };
  let generationErrors = [];
  if (patch.stage === "reviewing" && !body.question) ({ job, generationErrors } = await reviewingGenerationResult(job));
  // After the reviewing result, which replaces generationErrors.
  if (!body.question && patch.stage !== undefined && previousStage === "new" && job.stage && job.stage !== "new") {
    try {
      await recordReviewDecision({ job, fromStage: "new", toStage: job.stage, decision, score: jobSummary(job).score });
    } catch (error) {
      console.warn("Saved a stage change; its review decision could not be recorded.", error?.message || "");
      generationErrors.push("The stage was saved, but the reason could not be recorded.");
    }
  }
  if (patch.stage === "applied" && !body.question) {
    try {
      const application = await getApplicationCv(job.id);
      if (application?.currentVersionId) await markApplicationCvSubmitted(job.id, body.cvVersionId || application.currentVersionId);
    } catch (error) { generationErrors.push(error.message || 'The stage was saved, but the CV version could not be recorded.'); }
  }
  return { status: 200, json: { generationErrors, job: { ...jobSummary(job),
    ...await cvWriteFields(job, generationErrors),
    ...Object.fromEntries(Object.keys(patch).map(k => [k, job[k]])),
    ...(body.question ? { questions: job.questions } : {}),
  } } };
}

const jobsHandler = withSettingsHandler(handler);
// Share the existing function to stay within the current hosting plan. CV
// previews have their own scoped read token and must bypass the jobs auth wrapper.
// The email routine has its own secret, so it bypasses the admin wrapper too.
export default async function route(req, res) {
  if (req.query?.document === 'cv') {
    const { default: cvHandler } = await import('../../lib/handlers/admin-cv.js');
    return cvHandler(req, res);
  }
  if (req.query?.routine) return routineHandler(req, res);
  return jobsHandler(req, res);
}
