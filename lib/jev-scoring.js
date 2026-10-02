import { DEFAULT_SETTINGS } from "./sanity/analysis-defaults.js";
import { analysisSettings, settingsText, settingsQuestion } from "./sanity/analysis-settings.js";
import { createHash } from "node:crypto";
import { evaluateJev, JEV_MODEL, JEV_POLICY_VERSION } from "./jev.js";

export const FIT_DIMENSIONS = DEFAULT_SETTINGS.dimensions;
// A plausible match is useful to investigate, but should not read as a strong fit.
const FIT_RATING_POINTS = [0, 20, 40, 65, 100];
const PARTIAL_POSTING_CEILING = 70;
// Career progression is a small preference, not a gate on sustainable employment.
const CORE_FIT_IDS = ["responsibilities", "evidence"];
function ratingPoints(rating) {
  const low = Math.floor(rating), high = Math.ceil(rating);
  return Math.round(FIT_RATING_POINTS[low] + (FIT_RATING_POINTS[high] - FIT_RATING_POINTS[low]) * (rating - low));
}
const SCORING_POLICY = "2026-10-02-sustainable-management-1";
export function scoringInput(job) {
  return { candidate: settingsText("candidateProfile"), preferences: String(job.instructions || ""),
    // Factual recruiter clarifications belong to the shared scoring/summary
    // snapshot. Preserve their wording; a discussion is not a confirmed offer.
    notes: String(job.notes || ""),
    opportunity: Object.fromEntries(["company", "role", "jobDescription", "location", "locationMode", "salary"].map(k => [k, String(job[k] || "")])) };
}
export function scoringFingerprint(job) {
  return createHash("sha256").update(JSON.stringify({ input: scoringInput(job), model: JEV_MODEL,
    policy: SCORING_POLICY, transportPolicy: JEV_POLICY_VERSION,
    dimensions: analysisSettings().dimensions.map(({ id, label, weight }) => ({ id, label, weight })),
    questions: scoringQuestions() })).digest("hex");
}
export function scoringQuestions() {
  const keys = [...FIT_DIMENSIONS.map(d => d.id), "posting", "constraint"];
  return Object.fromEntries(keys.map(key => [key, settingsQuestion(key)]));
}
export function assessmentIsCurrent(job) {
  const fingerprint=job.jevAssessment?.fingerprint;
  // Older policies applied evidence-sufficiency caps. Keep their saved scores,
  // but require reassessment rather than treating them as equivalent results.
  return !!fingerprint && fingerprint===scoringFingerprint(job);
}
export async function assessFit(job, ref) {
  const { answers } = await evaluateJev({ state: scoringInput(job), questions: scoringQuestions(), kind: "jev-fit", ref });
  const dimensions = analysisSettings().dimensions.map(d => ({ id: d.id, label: d.label, weight: d.weight,
    score: ratingPoints(answers[d.id].score),
    confidence: answers[d.id].confidence, probabilities: answers[d.id].probabilities }));
  const posting = answers.posting, constraint = answers.constraint;
  const provisional = posting.choice !== "complete" || posting.probabilities.complete < 0.8;
  const weightedScore = Math.round(dimensions.reduce((sum, d) => sum + d.score * d.weight / 100, 0));
  const coreScores = dimensions.filter(d => CORE_FIT_IDS.includes(d.id)).map(d => d.score);
  const coreCeiling = coreScores.some(score => score <= FIT_RATING_POINTS[1]) ? 55
    : coreScores.some(score => score < FIT_RATING_POINTS[3]) ? 70 : 100;
  const postingCeiling = posting.choice !== "complete" || posting.probabilities.complete < 0.8
    ? PARTIAL_POSTING_CEILING : 100;
  const score = Math.min(weightedScore, coreCeiling, postingCeiling);
  const blocked = constraint.choice === "conflict" && constraint.probabilities.conflict >= 0.85;
  return { model: JEV_MODEL, policy: SCORING_POLICY, fingerprint: scoringFingerprint(job),
    assessedAt: new Date().toISOString(), score, dimensions, posting, constraint, blocked,
    provisional, status: blocked ? "constraint-conflict" : provisional ? "provisional" : "complete" };
}
