// Seed/offline values only. Hosted proposal writes read the published
// `emailStatusProposals` object; while it is unpublished (or disabled) the
// endpoint the daily email routine calls refuses new proposals. Applying,
// dismissing and the interview timeline work either way.
export const DEFAULT_EMAIL_STATUS = {
  enabled: false,
  minimumConfidence: 0.6,
};

export const EMAIL_STATUS_CONFIDENCE_MIN = 0.3;
export const EMAIL_STATUS_CONFIDENCE_MAX = 0.99;

const invalid = () => Object.assign(new Error("Publish valid email status proposal settings in Sanity."),
  { status: 503, code: "SANITY_SETTINGS_INVALID" });

export function validateEmailStatus(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.enabled !== "boolean"
    || typeof value.minimumConfidence !== "number" || !Number.isFinite(value.minimumConfidence)
    || value.minimumConfidence < EMAIL_STATUS_CONFIDENCE_MIN || value.minimumConfidence > EMAIL_STATUS_CONFIDENCE_MAX) throw invalid();
  return { enabled: value.enabled, minimumConfidence: value.minimumConfidence };
}
