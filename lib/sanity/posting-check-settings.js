// Seed/offline values only. Hosted checks read the published `postingCheck`
// object; while it is unpublished (or disabled) no posting is checked and no
// application form is fetched or answered.
export const DEFAULT_POSTING_CHECK = {
  enabled: false,
  gapThreshold: 0.5,
  fetchApplicationForms: true,
  draftAnswers: true,
  maxDraftAnswers: 8,
  requestTimeoutSeconds: 20,
};

export const POSTING_CHECK_THRESHOLD_MIN = 0.1;
export const POSTING_CHECK_THRESHOLD_MAX = 0.9;
export const POSTING_CHECK_MAX_ANSWERS = 20;

const invalid = () => Object.assign(new Error("Publish valid posting check settings in Sanity."),
  { status: 503, code: "SANITY_SETTINGS_INVALID" });

export function validatePostingCheck(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["enabled", "fetchApplicationForms", "draftAnswers"].every(key => typeof value[key] === "boolean")
    || typeof value.gapThreshold !== "number" || !Number.isFinite(value.gapThreshold)
    || value.gapThreshold < POSTING_CHECK_THRESHOLD_MIN || value.gapThreshold > POSTING_CHECK_THRESHOLD_MAX
    || !Number.isInteger(value.maxDraftAnswers) || value.maxDraftAnswers < 0 || value.maxDraftAnswers > POSTING_CHECK_MAX_ANSWERS
    || !Number.isInteger(value.requestTimeoutSeconds) || value.requestTimeoutSeconds < 5 || value.requestTimeoutSeconds > 60) throw invalid();
  return { enabled: value.enabled, gapThreshold: value.gapThreshold, fetchApplicationForms: value.fetchApplicationForms,
    draftAnswers: value.draftAnswers, maxDraftAnswers: value.maxDraftAnswers, requestTimeoutSeconds: value.requestTimeoutSeconds };
}
