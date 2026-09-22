import { DEFAULT_SETTINGS } from "./sanity/analysis-defaults.js";
import { analysisSettings, settingsText, settingsFingerprint, settingsQuestion } from "./sanity/analysis-settings.js";
import { createHash } from "node:crypto";
import { evaluateJev, JEV_MODEL, JEV_POLICY_VERSION } from "./jev.js";

export const FIT_DIMENSIONS = DEFAULT_SETTINGS.dimensions;
// A plausible match is useful to investigate, but should not read as a strong fit.
const FIT_RATING_POINTS = [0, 20, 40, 65, 100];
const LIMITED_EVIDENCE_CEILING = FIT_RATING_POINTS[2];
const PARTIAL_POSTING_CEILING = 70;
const CORE_FIT_IDS = ["responsibilities", "evidence", "direction"];
function ratingPoints(rating) {
  const low = Math.floor(rating), high = Math.ceil(rating);
  return Math.round(FIT_RATING_POINTS[low] + (FIT_RATING_POINTS[high] - FIT_RATING_POINTS[low]) * (rating - low));
}
const SCORING_POLICY = "2026-09-21-stricter-fit-1";
export function scoringInput(job) {
  return { candidate: settingsText("candidateProfile"), preferences: String(job.instructions || ""),
    opportunity: Object.fromEntries(["company", "role", "jobDescription", "location", "locationMode", "salary"].map(k => [k, String(job[k] || "")])) };
}
export function scoringFingerprint(job) {
  return createHash("sha256").update(JSON.stringify({ input: scoringInput(job), model: JEV_MODEL,
    settings: settingsFingerprint(), policy: SCORING_POLICY, transportPolicy: JEV_POLICY_VERSION, dimensions: FIT_DIMENSIONS,
    questions: scoringQuestions() })).digest("hex");
}
export function scoringQuestions() {
  const keys = [...FIT_DIMENSIONS.flatMap(d => [d.id, d.id + "Known"]), "posting", "constraint"];
  return Object.fromEntries(keys.map(key => [key, settingsQuestion(key)]));
}
export async function assessFit(job, ref) {
  const { answers } = await evaluateJev({ state: scoringInput(job), questions: scoringQuestions(), kind: "jev-fit", ref });
  const dimensions = analysisSettings().dimensions.map(d => ({ id: d.id, label: d.label, weight: d.weight,
    score: Math.min(answers[d.id + "Known"].probability < 0.8 ? LIMITED_EVIDENCE_CEILING : 100,
      ratingPoints(answers[d.id].score)),
    confidence: answers[d.id].confidence, probabilities: answers[d.id].probabilities,
    evidenceProbability: answers[d.id + "Known"].probability,
    evidenceLimited: answers[d.id + "Known"].probability < 0.8,
    evidenceNote: answers[d.id + "Known"].probability < 0.8 ? d.gap : "" }));
  const posting = answers.posting, constraint = answers.constraint;
  const provisional = dimensions.some(d => d.evidenceLimited) || posting.choice !== "complete" || posting.probabilities.complete < 0.8;
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
