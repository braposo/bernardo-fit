import { researchInputsAreCurrent } from "./generation-fingerprint.js";
import { assessmentIsCurrent } from "./jev-scoring.js";
import { timelineView } from "./interview-timeline.js";

// Explicit HTTP projections. New stored fields are private until selected here.
const SUMMARY_FIELDS = ["id", "revision", "company", "role", "source", "sourceType", "sourceUrl", "threadId",
  "location", "locationMode", "salary", "replyOwed",
  "userViewed", "closed", "archived", "archivedAt", "stage", "fitReportId", "receivedAt", "createdAt", "updatedAt",
  "coverLetterId", "coverLetterAt", "coverLetterModel", "coverLetterWords", "coverLetterVersionCount", "coverRun",
  "researchId", "researchAt", "researchModel", "researchSourceCount", "researchPartial", "researchFingerprint", "researchRun",
  "briefId", "briefAt", "briefModel", "briefFingerprint", "briefStage", "briefRun", "prepareRun", "analysisRun", "applicationRun"];

export const AGENT_LEANS = ["advance", "drop", "ask"];
const probability = value => typeof value === "number" && Number.isFinite(value) ? value : null;
// The review agent's suggestion as the admin sees it, or null. Internal fields
// (which assessment it read, the prompt policy) stay private.
export function agentReviewView(review) {
  if (!review || typeof review !== "object" || !AGENT_LEANS.includes(review.lean)) return null;
  return { lean: review.lean, advanceProbability: probability(review.advanceProbability),
    dropProbability: probability(review.dropProbability), reason: String(review.reason || ""),
    question: review.lean === "ask" ? String(review.question || "") : "", reviewedAt: review.reviewedAt || "",
    model: review.model || "", examples: Number.isInteger(review.examples) ? review.examples : 0,
    // Only after the agent moved the job itself: where to, when, and when Bernardo undid it.
    ...(review.autoMove?.stage ? { autoMove: { stage: review.autoMove.stage, at: review.autoMove.at || "",
      overriddenAt: review.autoMove.overriddenAt || "" } } : {}) };
}

export const GAP_KINDS = ["salary", "location", "seniority", "contract"];
export const GAP_STATES = ["open", "dismissed", "asked"];
export const FORM_QUESTION_STATES = ["pending", "drafted", "approved", "skipped"];
const text = (value, max) => String(value || "").slice(0, max);
// The posting check as the admin sees it, or null. Internal fields (the input
// fingerprint, the ATS facts, the writer model) stay private.
export function postingCheckView(check) {
  if (!check || typeof check !== "object" || !check.checkedAt && !check.form) return null;
  const form = check.form && typeof check.form === "object" ? check.form : {};
  return {
    status: text(check.status, 20), policy: text(check.policy, 60), checkedAt: text(check.checkedAt, 40),
    draftStatus: text(check.draftStatus, 30),
    gaps: (Array.isArray(check.gaps) ? check.gaps : []).filter(g => GAP_KINDS.includes(g?.kind)).map(g => ({
      id: text(g.id, 40), kind: g.kind, label: text(g.label, 80), why: text(g.why, 300), question: text(g.question, 300),
      state: GAP_STATES.includes(g.state) ? g.state : "open" })),
    form: { source: text(form.source, 20), url: text(form.url, 500), status: text(form.status, 30),
      questions: (Array.isArray(form.questions) ? form.questions : []).filter(q => q?.id && q.text).map(q => ({
        id: text(q.id, 40), text: text(q.text, 2000), required: !!q.required,
        options: Array.isArray(q.options) ? q.options.slice(0, 30).map(o => text(o, 200)) : [],
        answerDraft: text(q.answerDraft, 8000), needsYou: !!q.needsYou, reason: text(q.reason, 300),
        state: FORM_QUESTION_STATES.includes(q.state) ? q.state : "pending" })) },
  };
}

export function jobSummary(job) {
  const out = Object.fromEntries(SUMMARY_FIELDS.filter(k => job[k] !== undefined).map(k => [k, job[k]]));
  Object.assign(out, { score: null, tier: "", scoreBreakdown: null, rationale: "" });
  out.jevRun = job.jevRun || null;
  out.jevAssessment = job.jevAssessment || null;
  out.jevStale = !!job.jevAssessment && !assessmentIsCurrent(job);
  out.agentReview = agentReviewView(job.agentReview);
  out.postingCheck = postingCheckView(job.postingCheck);
  if (job.jevAssessment) {
    // Keep the last saved assessment visible while its inputs need reassessment.
    out.score = job.jevAssessment.score ?? null;
    out.tier = out.jevStale ? "Needs reassessment" : job.jevAssessment.blocked ? "Constraint conflict" :
      out.score === null ? "Needs more information" : out.score >= 80 ? "Act now" : out.score >= 58 ? "Worth a look" : out.score >= 40 ? "Background" : "Off-target";
    out.scoreBreakdown = Object.fromEntries(job.jevAssessment.dimensions.map(d => [d.id, d.score]));
    out.rationale = "";
  }
  out.recruiter = job.recruiter ? {
    name: job.recruiter.name || "", org: job.recruiter.org || "", daysWaiting: job.recruiter.daysWaiting ?? null,
  } : null;
  out.hasDescription = !!job.jobDescription;
  out.hasInstructions = !!job.instructions;
  out.hasNotes = !!job.notes;
  out.hasCoverLetter = !!job.coverLetterId || !!job.coverLetter;
  out.hasResearch = !!job.researchId;
  out.hasBrief = !!job.briefId;
  out.researchStale = !!job.researchId && (!researchInputsAreCurrent(job) ||
    Date.now() - (Date.parse(job.researchAt) || 0) > 7 * 24 * 60 * 60 * 1000);
  out.briefStale = !!job.briefId && !job.briefFingerprint;
  out.letterVersionCount = Number(job.coverLetterVersionCount) || (job.coverLetterVersions || []).length;
  out.questionCount = (job.questions || []).length;
  out.answeredCount = (job.questions || []).filter(q => q.a || q.refused).length;
  out.answerRuns = (job.questions || []).filter(q => q.run?.runId &&
    ["dispatching", "queued"].includes(q.run.status)).map(q => ({ questionId: q.id, run: q.run }));
  return out;
}

export function jobDetail(job) {
  const summary = job.overviewSummary;
  const current = summary && assessmentIsCurrent(job) && summary.fingerprint === job.jevAssessment?.fingerprint && summary.assessedAt === job.jevAssessment?.assessedAt;
  return { ...jobSummary(job), jobDescription: job.jobDescription || "", notes: job.notes || "",
    instructions: job.instructions || "", questions: job.questions || [],
    interviewTimeline: timelineView(job.interviewTimeline),
    overviewSummary: current ? { position: summary.position, fit: summary.fit,
      fingerprint: summary.fingerprint, assessedAt: summary.assessedAt } : null };
}

export function haystack(j) {
  return [j.company, j.role, j.source, j.location, j.locationMode, j.salary, j.notes,
    j.rationale, j.jobDescription, j.tier, j.stage, j.recruiter?.name, j.recruiter?.org]
    .filter(Boolean).join(" ").toLowerCase();
}

export function searchTerms(q) {
  return [...String(q || "").toLowerCase().matchAll(/"([^"]*)"|(\S+)/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]).trim()).filter(Boolean);
}

export function matchesSearch(job, query) {
  const text = haystack(job);
  return searchTerms(query).every(term => text.includes(term));
}
