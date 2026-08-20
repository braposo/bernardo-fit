// Which model writes the analysis, the letter and the form answers.
//
// Sonnet stays the default. Opus is there to compare against, since the whole
// value of this app is writing quality and that is worth measuring rather than
// assuming.
//
// Two behavioural differences that matter here, from the Claude API docs:
//
//   - Opus 5 runs adaptive thinking by default; Sonnet 5 does not unless asked.
//     That is a good thing for writing quality and the reason to try it, but it
//     costs tokens and time on generations that already take a while. Thinking
//     blocks are returned with empty text by default and every caller filters
//     to text blocks, so nothing downstream needs to change.
//   - Opus 5 can answer with stop_reason "refusal". Callers check for it, so a
//     refusal surfaces as a clear error rather than an empty draft that then
//     fails somewhere less obvious.
//
// budget_tokens is rejected by both, so nothing here sets it.

export const DEFAULT_MODEL = "claude-sonnet-5";

export const MODELS = [
  {
    id: "claude-sonnet-5",
    label: "Sonnet",
    note: "Default. Faster and cheaper.",
  },
  {
    id: "claude-opus-5",
    label: "Opus",
    note: "Thinks before writing. Slower and dearer.",
  },
];

const IDS = MODELS.map((m) => m.id);

// Anything unrecognised falls back rather than erroring. A bad value in a
// request body should not stop a letter being written, and silently spending
// Opus money because of a typo would be worse than ignoring it.
export function resolveModel(id) {
  const v = String(id || "").trim();
  return IDS.includes(v) ? v : DEFAULT_MODEL;
}

export function isKnownModel(id) {
  return IDS.includes(String(id || "").trim());
}

export function modelLabel(id) {
  const m = MODELS.find((x) => x.id === id);
  return m ? m.label : "";
}

// Opus can decline a request outright. Without this the caller would get an
// empty content array and fail later as a parse error, which says nothing
// useful about what happened.
export function refusalError(data) {
  if (!data || data.stop_reason !== "refusal") return null;
  const d = data.stop_details || {};
  const why = d.explanation || d.category || "no reason given";
  return Object.assign(new Error("The model declined to write this: " + why), { status: 502 });
}
