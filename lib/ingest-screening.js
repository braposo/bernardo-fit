import { assessFit, scoringFingerprint } from "./jev-scoring.js";
import { getTaskInput, saveTaskInput } from "./task-results.js";
import { summariseOverview, OVERVIEW_MODEL, OVERVIEW_POLICY } from "./overview-summary.js";

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
  let assessment;
  try {
    assessment = await getTaskInput("ingest-assessment", cacheId);
    if (!assessment) {
      assessment = await assessFit(opportunity, `ingest:${requestId}`);
      assessment = await saveTaskInput("ingest-assessment", cacheId, assessment);
    }
  } catch (error) {
    // A failed evaluation never admits an unscored job. Report the failure and
    // leave it uncached so a resubmission can retry it.
    return { decision: "evaluation-failed", assessment: null,
      error: error?.status ? error.message : "Could not assess this opportunity. Retry the import." };
  }
  const decision = admissionDecision(assessment, minimumScore);
  if (decision !== "accepted") return { decision, assessment };
  // Only admitted candidates need prose. Checkpoint it separately so a failed
  // summary can be retried without paying for the assessment again.
  const summaryKey = `${cacheId}:${assessment.assessedAt}:${OVERVIEW_MODEL}:${OVERVIEW_POLICY}`;
  try {
    let overviewSummary = await getTaskInput("ingest-overview", summaryKey);
    if (!overviewSummary) overviewSummary = await saveTaskInput("ingest-overview", summaryKey,
      await summariseOverview(opportunity, assessment, `ingest:${requestId}`));
    return { decision, assessment, overviewSummary };
  } catch {
    return { decision: "summary-failed", assessment,
      error: "Could not create the overview summary. Retry the import." };
  }
}
