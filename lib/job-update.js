// The jobs PATCH path, shared by a manual edit in the admin, applying an email
// status proposal and the review agent's automatic moves, so every stage change
// has the same audit, archiving, review decision, Reviewing generation and CV
// submission. Lives in lib so the review-job Trigger task can call it.
import { mutateJob, editQuestion, JOB_STAGES, normaliseJobStage } from "./store.js";
import { jobSummary } from "./job-view.js";
import { reviewingGenerationResult } from "./reviewing-generation.js";
import { getApplicationCv, markApplicationCvSubmitted } from "./application-cv-store.js";
import { withApplicationCvFields } from "./application-cv-view.js";
import { recordReviewDecision, validateDecisionInput, decisionDirection } from "./review-decisions.js";

export async function cvFields(job) {
  const { hasCv, cvRun, applicationFitUrl, applicationCv, generalCv } = await withApplicationCvFields(job);
  return { hasCv, cvRun, applicationFitUrl, applicationCv, generalCv };
}
export async function cvWriteFields(job, errors) {
  try { return await cvFields(job); }
  catch { errors.push('The role was saved, but its CV status could not be refreshed. Reload to check it.'); return {}; }
}

// Bernardo undoing a move the review agent made: he moves an auto-moved job to
// a stage the agent would not have chosen (back to New, or the other way), or
// restores an auto-dropped job from Archive. Returns { fromStage, toStage } or null.
export function agentMoveOverride(current, patch) {
  const move = current?.agentReview?.autoMove;
  if (!move?.stage || move.overriddenAt) return null;
  const stage = normaliseJobStage(current.stage) || "new";
  if (stage !== move.stage) return null;
  const toStage = patch.stage !== undefined ? patch.stage : stage;
  if (toStage !== stage) return decisionDirection(toStage) === decisionDirection(stage) ? null : { fromStage: stage, toStage };
  return patch.archived === false && current.archived && decisionDirection(stage) === "drop" ? { fromStage: stage, toStage } : null;
}

// extraPatch(current) adds fields to the same guarded write (a proposal's
// timeline entry and learned email ids, the agent's move marker). guard(current)
// returning false leaves the job untouched and returns 409. actor "agent" records
// the review decision as the agent's own (decidedBy: "agent"), never Bernardo's.
// fromWorker skips the app-only storage check before Reviewing generation.
// Returns { status, json }.
export async function updateJobFromBody(id, body, { extraPatch, guard, actor = "admin", fromWorker = false, now = new Date() } = {}) {
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
  let previousStage, override = null, blocked = false;
  // Shared storage applies terminal-stage archiving and explicit restores.
  let job = body.question ? await editQuestion(id, body.question)
    : await mutateJob(id, current => {
      blocked = !!guard && !guard(current);
      if (blocked) return undefined;
      previousStage = normaliseJobStage(current.stage) || "new";
      override = actor === "agent" ? null : agentMoveOverride(current, patch);
      const changed = key => body[key] !== undefined && JSON.stringify(body[key]) !== JSON.stringify(current[key] ?? "");
      const invalidation = {};
      if (["company", "role", "sourceUrl"].some(changed)) invalidation.researchFingerprint = "";
      if (["company", "role", "sourceUrl", "notes", "instructions", "jobDescription", "fitReportId", "location", "locationMode", "salary", "questions"].some(changed)) invalidation.briefFingerprint = "";
      // Marked once, so a later edit cannot record the same disagreement twice.
      const undone = override ? { agentReview: { ...current.agentReview,
        autoMove: { ...current.agentReview.autoMove, overriddenAt: now.toISOString() } } } : {};
      return { ...patch, ...invalidation, ...undone, ...(extraPatch ? extraPatch(current) : {}) };
    }, { expectedRevision: body.questions !== undefined ? body.revision : undefined });
  if (!job) return { status: 404, json: { error: "Job not found" } };
  if (blocked) return { status: 409, json: { error: "The job changed before this could be saved." } };
  let generationErrors = [];
  if (patch.stage === "reviewing" && !body.question) ({ job, generationErrors } = await reviewingGenerationResult(job, { fromWorker }));
  // After the reviewing result, which replaces generationErrors.
  const decidedBy = actor === "agent" ? "agent" : "bernardo";
  if (!body.question && patch.stage !== undefined && previousStage === "new" && job.stage && job.stage !== "new") {
    try {
      await recordReviewDecision({ job, fromStage: "new", toStage: job.stage, decision, score: jobSummary(job).score, decidedBy, now });
    } catch (error) {
      console.warn("Saved a stage change; its review decision could not be recorded.", error?.message || "");
      generationErrors.push("The stage was saved, but the reason could not be recorded.");
    }
  }
  // Undoing an agent move is Bernardo's disagreement with it.
  if (override) {
    try {
      await recordReviewDecision({ job, fromStage: override.fromStage, toStage: override.toStage, decision,
        score: jobSummary(job).score, decidedBy: "bernardo", overridesAgent: true, now });
    } catch (error) {
      console.warn("Saved a change to an agent move; its disagreement could not be recorded.", error?.message || "");
      generationErrors.push("The change was saved, but the disagreement with the review agent could not be recorded.");
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
