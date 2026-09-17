export const DEFAULT_MODEL = "gpt-5.6-sol";
// Reports created before model attribution used Opus.
export const LEGACY_MODEL = "claude-opus-5";

export const MODELS = [
  { id: "gpt-5.6-sol", label: "Sol", note: "Default. Balanced writing quality and cost." },
  { id: "gpt-6-astra", label: "Astra", note: "Alternative for more demanding analysis." },
  {
    id: "claude-opus-5",
    label: "Opus",
    note: "Alternative. Thinks before writing.",
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

export function modelProvider(id) {
  return resolveModel(id).startsWith("gpt-") ? "openai" : "anthropic";
}
