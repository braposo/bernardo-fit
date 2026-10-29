// Seed/offline values only. Hosted reviews read the published `reviewAgent`
// object; while it is unpublished (or disabled) no job is reviewed.
// autoAdvance and autoDrop let the agent move a job itself, and only while its
// agreement with Bernardo over recent calls is at least autoMinimumAgreement
// with at least autoMinimumDecided calls. Both gates must be published: while
// either is missing the agent stays in shadow mode. learnPreferences turns on
// the weekly task that proposes plain-language rules from his decisions.
export const DEFAULT_REVIEW_AGENT = {
  enabled: false,
  advanceThreshold: 0.85,
  dropThreshold: 0.85,
  autoAdvance: false,
  autoDrop: false,
  exampleCount: 5,
  autoMinimumAgreement: 0.85,
  autoMinimumDecided: 20,
  learnPreferences: false,
};

export const REVIEW_AGENT_THRESHOLD_MIN = 0.5;
export const REVIEW_AGENT_THRESHOLD_MAX = 0.99;
export const REVIEW_AGENT_MAX_EXAMPLES = 10;
export const REVIEW_AGENT_AGREEMENT_MIN = 0.5;
export const REVIEW_AGENT_DECIDED_MIN = 5;
export const REVIEW_AGENT_DECIDED_MAX = 100;

const invalid = () => Object.assign(new Error("Publish valid review agent settings in Sanity."),
  { status: 503, code: "SANITY_SETTINGS_INVALID" });
const threshold = value => typeof value === "number" && Number.isFinite(value)
  && value >= REVIEW_AGENT_THRESHOLD_MIN && value <= REVIEW_AGENT_THRESHOLD_MAX;
const missing = value => value === undefined || value === null;
// The auto-move gates and learnPreferences came later: absent is valid and
// means closed (no automatic move) and off. Present must be valid.
const agreement = value => missing(value) || (typeof value === "number" && Number.isFinite(value) && value >= REVIEW_AGENT_AGREEMENT_MIN && value <= 1);
const decided = value => missing(value) || (Number.isInteger(value) && value >= REVIEW_AGENT_DECIDED_MIN && value <= REVIEW_AGENT_DECIDED_MAX);

export function validateReviewAgent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["enabled", "autoAdvance", "autoDrop"].every(key => typeof value[key] === "boolean")
    || !threshold(value.advanceThreshold) || !threshold(value.dropThreshold)
    || !Number.isInteger(value.exampleCount) || value.exampleCount < 0 || value.exampleCount > REVIEW_AGENT_MAX_EXAMPLES
    || !agreement(value.autoMinimumAgreement) || !decided(value.autoMinimumDecided)
    || !(missing(value.learnPreferences) || typeof value.learnPreferences === "boolean")) throw invalid();
  return { enabled: value.enabled, advanceThreshold: value.advanceThreshold, dropThreshold: value.dropThreshold,
    autoAdvance: value.autoAdvance, autoDrop: value.autoDrop, exampleCount: value.exampleCount,
    autoMinimumAgreement: value.autoMinimumAgreement ?? null, autoMinimumDecided: value.autoMinimumDecided ?? null,
    learnPreferences: value.learnPreferences ?? false };
}
