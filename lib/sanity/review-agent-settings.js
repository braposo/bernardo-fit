// Seed/offline values only. Hosted reviews read the published `reviewAgent`
// object; while it is unpublished (or disabled) no job is reviewed.
// autoAdvance and autoDrop are validated now but not acted on: the agent runs in
// shadow mode and only records its recommendation.
export const DEFAULT_REVIEW_AGENT = {
  enabled: false,
  advanceThreshold: 0.85,
  dropThreshold: 0.85,
  autoAdvance: false,
  autoDrop: false,
  exampleCount: 5,
};

export const REVIEW_AGENT_THRESHOLD_MIN = 0.5;
export const REVIEW_AGENT_THRESHOLD_MAX = 0.99;
export const REVIEW_AGENT_MAX_EXAMPLES = 10;

const invalid = () => Object.assign(new Error("Publish valid review agent settings in Sanity."),
  { status: 503, code: "SANITY_SETTINGS_INVALID" });
const threshold = value => typeof value === "number" && Number.isFinite(value)
  && value >= REVIEW_AGENT_THRESHOLD_MIN && value <= REVIEW_AGENT_THRESHOLD_MAX;

export function validateReviewAgent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["enabled", "autoAdvance", "autoDrop"].every(key => typeof value[key] === "boolean")
    || !threshold(value.advanceThreshold) || !threshold(value.dropThreshold)
    || !Number.isInteger(value.exampleCount) || value.exampleCount < 0 || value.exampleCount > REVIEW_AGENT_MAX_EXAMPLES) throw invalid();
  return { enabled: value.enabled, advanceThreshold: value.advanceThreshold, dropThreshold: value.dropThreshold,
    autoAdvance: value.autoAdvance, autoDrop: value.autoDrop, exampleCount: value.exampleCount };
}
