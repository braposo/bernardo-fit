import { analysisSettings } from "./sanity/analysis-settings.js";
import { DEFAULT_SETTINGS } from "./sanity/analysis-defaults.js";
import { PUBLIC_MODEL, resolveModel } from "./models.js";

export const ANSWER_POLICY_VERSION = "2026-09-09-economy-1";
const normalize = question => String(question || "").toLowerCase().trim().replace(/[?!.]+$/, "").replace(/\s+/g, " ");

// Exact, single-intent matches only. Country changes, compound questions,
// future sponsorship, start dates and travel commitments must reach the model.
export function answerPolicy({ question, model, economy = false, instructions = "", report }) {
  const q = normalize(question);
  // Trusted steering can change facts, language or format; never bypass it.
  const eligible = economy === true && !String(instructions || "").trim();
  const fact = eligible ? analysisSettings().facts.find(f => normalize(f.question) === q)?.answer || "" : "";
  const routine = eligible && analysisSettings().routineQuestions.some(value => normalize(value) === q) && !!report?.pitch;
  return { fact, compact: routine, model: routine ? PUBLIC_MODEL : resolveModel(model), effort: routine ? "medium" : "high" };
}

// Small, maintained selection from profile.js, supplemented by the role's
// existing fit evidence. Used only for the narrow motivation questions above.
export const MOTIVATION_PROFILE = DEFAULT_SETTINGS.texts.motivationProfile;
