// Bernardo's call on each job he moves out of New, with his reasons. Stored in
// Sanity as `reviewDecision` documents so a future review agent can learn what
// he advances and what he drops. One document per decision; records are never
// edited after they are written.
import { createStorageClient, sanityStorageEnabled } from "./sanity/client.js";
import { reviewReasonSettings } from "./sanity/analysis-settings.js";
import { REVIEW_REASON_MAX_LENGTH } from "./sanity/review-reasons.js";
import { agentReviewView } from "./job-view.js";

export const REVIEW_DECISION_TYPE = "reviewDecision";
export const MAX_DECISION_REASONS = 5;
export const MAX_DECISION_NOTE_LENGTH = 1000;
export const LEARNED_REASON_LIMIT = 5;
const LEARNING_WINDOW = 500;
const LIST_LIMIT = 1000;

const ADVANCE_STAGES = ["reviewing", "applied", "interviewing", "offer"];
const DROP_STAGES = ["not_interested"];

// Without Sanity storage (tests and offline development) records stay in memory.
// A client injected for tests is used even then, so tests can exercise the
// Sanity path and its failures; pass null to go back to the default.
const memory = new Map();
let clientInstance, injected = false;
const client = () => clientInstance ||= createStorageClient();
const useSanity = () => injected || sanityStorageEnabled();
export function setReviewDecisionClient(next) { clientInstance = next || undefined; injected = !!next; }
export function resetReviewDecisionsForTests() { memory.clear(); }

export const reviewDecisionDocumentId = (jobId, decidedAt) => `review-decision.${jobId}.${decidedAt}`;

export function decisionDirection(stage) {
  if (ADVANCE_STAGES.includes(stage)) return "advance";
  if (DROP_STAGES.includes(stage)) return "drop";
  return "other";
}

const badRequest = message => Object.assign(new Error(message), { status: 400 });

// Validates the optional `decision` body field. Absent means no reasons and no note.
export function validateDecisionInput(value) {
  if (value === undefined || value === null) return { reasons: [], note: "" };
  if (typeof value !== "object" || Array.isArray(value)) throw badRequest("The decision must be an object with reasons and a note.");
  const { reasons = [], note = "" } = value;
  if (!Array.isArray(reasons)) throw badRequest("Decision reasons must be a list.");
  const seen = new Set();
  const clean = [];
  for (const item of reasons) {
    const reason = typeof item === "string" ? item.trim() : "";
    if (!reason) throw badRequest("Each decision reason must be non-empty text.");
    if (reason.length > REVIEW_REASON_MAX_LENGTH) throw badRequest(`Each decision reason must be ${REVIEW_REASON_MAX_LENGTH} characters or fewer.`);
    const key = reason.toLowerCase();
    if (!seen.has(key)) { seen.add(key); clean.push(reason); }
  }
  if (clean.length > MAX_DECISION_REASONS) throw badRequest(`Choose at most ${MAX_DECISION_REASONS} decision reasons.`);
  if (typeof note !== "string") throw badRequest("The decision note must be text.");
  const trimmed = note.trim();
  if (trimmed.length > MAX_DECISION_NOTE_LENGTH) throw badRequest(`The decision note must be ${MAX_DECISION_NOTE_LENGTH} characters or fewer.`);
  return { reasons: clean, note: trimmed };
}

// The review agent's suggestion for the job as saved after the move: its lean,
// and its probability for the direction Bernardo chose (null for other moves).
export function decisionAgentFields(job, direction) {
  const review = agentReviewView(job?.agentReview);
  if (!review) return { agentLean: null, agentProbability: null };
  const probability = direction === "advance" ? review.advanceProbability : direction === "drop" ? review.dropProbability : null;
  return { agentLean: review.lean, agentProbability: probability ?? null };
}

// Builds the stored record from the saved job and the validated decision.
export function reviewDecisionRecord({ job, fromStage = "new", toStage, decision, score = null, now = new Date() }) {
  const { reasons, note } = validateDecisionInput(decision);
  const decidedAt = now.getTime();
  const direction = decisionDirection(toStage);
  return {
    _id: reviewDecisionDocumentId(job.id, decidedAt), _type: REVIEW_DECISION_TYPE,
    jobId: job.id, company: job.company || "", role: job.role || "",
    score: Number.isFinite(score) ? score : null,
    source: job.source || "", sourceUrl: job.sourceUrl || "",
    fromStage, toStage, direction,
    reasons, note,
    // Null unless the review agent suggested a call before Bernardo made his.
    ...decisionAgentFields(job, direction),
    decidedAt: now.toISOString(),
  };
}

export async function recordReviewDecision(entry) {
  const record = reviewDecisionRecord(entry);
  if (!useSanity()) {
    memory.set(record._id, record);
    return record;
  }
  // The ID is unique per job and millisecond, so a repeated write is a no-op.
  return client().createIfNotExists(record);
}

const LIST_FIELDS = "_id, jobId, company, role, score, source, sourceUrl, fromStage, toStage, direction, reasons, note, agentLean, agentProbability, decidedAt";

// Newest first.
export async function listReviewDecisions({ limit = 100 } = {}) {
  const count = Math.max(1, Math.min(LIST_LIMIT, Math.floor(Number(limit)) || 100));
  if (!useSanity()) return [...memory.values()]
    .sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt))).slice(0, count).map(doc => ({ ...doc }));
  return client().fetch(`*[_type == $type] | order(decidedAt desc)[0...${count}]{${LIST_FIELDS}}`, { type: REVIEW_DECISION_TYPE });
}

// Reasons used most often for one direction, most recent spelling first on ties,
// leaving out any already offered (case-insensitive).
function learnedReasons(decisions, direction, offered) {
  const taken = new Set(offered.map(reason => reason.toLowerCase()));
  const counts = new Map();
  decisions.forEach((decision, order) => {
    if (decision.direction !== direction) return;
    for (const raw of decision.reasons || []) {
      const reason = typeof raw === "string" ? raw.trim() : "";
      const key = reason.toLowerCase();
      if (!reason || reason.length > REVIEW_REASON_MAX_LENGTH || taken.has(key)) continue;
      const current = counts.get(key);
      if (current) current.count++;
      else counts.set(key, { reason, count: 1, order });
    }
  });
  return [...counts.values()].sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, LEARNED_REASON_LIMIT).map(entry => entry.reason);
}

// GET /api/admin/jobs?reviewReasons=1: published picks, then learned ones.
export async function reviewReasonOptions({ decisions } = {}) {
  const published = reviewReasonSettings();
  const history = decisions || await listReviewDecisions({ limit: LEARNING_WINDOW });
  const options = {};
  for (const direction of ["advance", "drop"]) {
    const offered = [...(published?.[direction] || [])];
    options[direction] = [...offered, ...learnedReasons(history, direction, offered)];
  }
  return options;
}
