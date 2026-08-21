// Which model writes the analysis, the letter and the form answers.
//
// Opus is the default. It costs more, but the whole value of this app is
// writing quality, and comparing the two on real roles made the difference
// clear enough to pay for. Sonnet stays available as the cheaper fallback.
//
// Two behavioural differences that matter here, from the Claude API docs:
//
//   - Opus 5 runs adaptive thinking by default; Sonnet 5 does not unless asked.
//     That is the reason it writes better, and it costs tokens and time on
//     generations that already take a while. Thinking blocks are returned with
//     empty text by default and every caller filters to text blocks, so nothing
//     downstream needs to change.
//   - Opus 5 can answer with stop_reason "refusal". Callers check for it, so a
//     refusal surfaces as a clear error rather than an empty draft that then
//     fails somewhere less obvious.
//
// budget_tokens is rejected by both, so nothing here sets it.

export const DEFAULT_MODEL = "claude-opus-5";

export const MODELS = [
  {
    id: "claude-opus-5",
    label: "Opus",
    note: "Default. Thinks before writing.",
  },
  {
    id: "claude-sonnet-5",
    label: "Sonnet",
    note: "Backup. Faster and cheaper.",
  },
];

// What anonymous visitors get. Pinned deliberately: the default above is
// chosen for the quality of my own letters, and letting a public endpoint
// follow it means every stranger runs the expensive model.
export const PUBLIC_MODEL = "claude-sonnet-5";

const IDS = MODELS.map((m) => m.id);

// Anything unrecognised falls back rather than erroring. A bad value in a
// request body should not stop a letter being written.
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
