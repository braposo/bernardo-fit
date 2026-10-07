export const DEFAULT_MODEL = "gpt-6.1-sol";
// Reports created before model attribution used Opus.
export const LEGACY_MODEL = "claude-opus-5";

// Model IDs verified against the providers' model lists on 2026-10-07.
export const MODELS = [
  { id: "gpt-6.1-sol", label: "Sol 6.1", note: "Default. Balanced writing quality and cost." },
  { id: "gpt-6-astra", label: "Astra", note: "Alternative for more demanding analysis." },
  {
    id: "claude-opus-5-5",
    label: "Opus 5.5",
    note: "Alternative. Thinks before writing.",
  },
  {
    id: "claude-sonnet-5-5",
    label: "Sonnet 5.5",
    note: "Backup. Faster and cheaper.",
  },
];

// Superseded IDs stay readable in version history, usage and older published
// settings, and resolve to their current replacement for new work.
export const RETIRED_MODELS = {
  "gpt-5.6-sol": { label: "Sol 5.6", replacement: "gpt-6.1-sol" },
  "claude-opus-5": { label: "Opus 5", replacement: "claude-opus-5-5" },
  "claude-sonnet-5": { label: "Sonnet 5", replacement: "claude-sonnet-5-5" },
};

// Public fallback when TypeSafe isn't configured. With Jev, the worker picks
// the least expensive sufficient writer; visitors cannot select a model.
export const PUBLIC_MODEL = "claude-sonnet-5-5";

const IDS = MODELS.map((m) => m.id);

export const MODEL_LABELS = Object.fromEntries([
  ...Object.entries(RETIRED_MODELS).map(([id, { label }]) => [id, label]),
  ...MODELS.map(({ id, label }) => [id, label]),
]);

// The current ID for a known model, or "" when it is not one of ours.
export function currentModel(id) {
  const v = String(id || "").trim();
  return IDS.includes(v) ? v : RETIRED_MODELS[v]?.replacement || "";
}

// Anything unrecognised falls back rather than erroring. A bad value in a
// request body should not stop a letter being written.
export function resolveModel(id) {
  return currentModel(id) || DEFAULT_MODEL;
}

export function isKnownModel(id) {
  return !!currentModel(id);
}

export function modelLabel(id) {
  return MODEL_LABELS[id] || "";
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
