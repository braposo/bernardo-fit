import { DEFAULT_SETTINGS } from "./analysis-defaults.js";
import { ANALYSIS_SETTINGS_ID } from "./analysis-settings.js";

const titles = {candidateProfile: "Candidate evidence (full)", motivationProfile: "Candidate context for motivation answers",
  interviewProfile: "Candidate context for interviews", slopTop: "Priority writing rules", antiSlop: "Writing style guide",
  proseRules: "Prose and sentence rules", analysis: "Fit analysis prompt", cover: "Cover letter prompt",
  answer: "Application answer prompt", compactAnswer: "Routine answer prompt", brief: "Interview brief prompt",
  research: "Company research prompt", overview: "Jev overview summary prompt"};

// Create once; subsequent editorial changes belong to Sanity, never to a seed overwrite.
export function initialSettingsDocument() {
  return {
    _id: ANALYSIS_SETTINGS_ID, _type: "analysisSettings", title: "Fit analysis settings",
    texts: Object.entries(DEFAULT_SETTINGS.texts).map(([key, text]) => ({_key: key, _type: "promptText", key, title: titles[key], text})),
    questions: Object.entries(DEFAULT_SETTINGS.questions).map(([key, q]) => ({
      _key: key, _type: "jevQuestion", key, type: q.type, instructions: q.instructions,
      ...(q.type === "score" ? {criteria: q.criteria} : {}),
      ...(q.type === "choice" ? {options: Object.entries(q.criteria).map(([key, text], i) =>
        ({_key: `option${i}`, _type: "jevOption", key, text}))} : {}),
    })),
    dimensions: DEFAULT_SETTINGS.dimensions.map(({criteria, ...d}) => ({_key: d.id, _type: "fitDimension", ...d})),
    facts: DEFAULT_SETTINGS.facts.map((f, i) => ({_key: `fact${i}`, _type: "factualAnswer", ...f})),
    routineQuestions: DEFAULT_SETTINGS.routineQuestions,
    personalFacts: {...DEFAULT_SETTINGS.personalFacts},
  };
}
