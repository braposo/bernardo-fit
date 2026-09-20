import { assessFit, scoringFingerprint } from "./jev-scoring.js";
import { getTaskInput, saveTaskInput } from "./task-results.js";

export function ingestMinimumScore(env = process.env) {
  const raw = String(env.JEV_INGEST_MIN_SCORE ?? "").trim();
  const score = raw === "" ? 60 : Number(raw);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw Object.assign(new Error("JEV_INGEST_MIN_SCORE must be an integer from 0 to 100."), { status: 503, abort: true });
  }
  return score;
}

export function admissionDecision(assessment, minimumScore) {
  if (assessment.blocked) return "constraint-conflict";
  if (!["complete", "provisional"].includes(assessment.status) || !Number.isFinite(assessment.score)) return "needs-review";
  if (["inaccessible", "unrelated"].includes(assessment.posting?.choice)) return "needs-review";
  return assessment.score >= minimumScore ? "accepted" : "below-threshold";
}

// Cache the assessment, not the admission decision: a new threshold can reuse
// evidence within the same request. Input/profile/rubric changes get a new key.
// These records expire with the retained import input after 30 days.
export async function screenOpportunity(opportunity, { requestId, minimumScore }) {
  const fingerprint = scoringFingerprint(opportunity);
  const cacheId = `${requestId}:${fingerprint}`;
  try {
    let assessment = await getTaskInput("ingest-assessment", cacheId);
    if (!assessment) {
      assessment = await assessFit(opportunity, `ingest:${requestId}`);
      assessment = await saveTaskInput("ingest-assessment", cacheId, assessment);
    }
    return { decision: admissionDecision(assessment, minimumScore), assessment };
  } catch (error) {
    // A failed evaluation never admits an unscored job. Report the failure and
    // leave it uncached so a resubmission can retry it.
    return { decision: "evaluation-failed", assessment: null,
      error: error?.status ? error.message : "Could not assess this opportunity. Retry the import." };
  }
}
