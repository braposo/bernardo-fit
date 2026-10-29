// Seed/offline values only. Hosted proposal writes read the published
// `emailStatusProposals` object; while it is unpublished (or disabled) the
// endpoint the daily email routine calls refuses new proposals. Applying,
// dismissing and the interview timeline work either way.
//
// `gmailCheck` drives the Trigger task that reads Gmail itself
// (docs/gmail-status-check.md). It is optional so documents published before
// it existed stay valid; while it is missing or disabled the task makes no
// Gmail or model request, and the routine endpoints behave as before.
export const DEFAULT_GMAIL_QUERY = 'newer_than:3d -category:promotions -category:social -from:me (interview OR application OR applied OR offer OR "next steps" OR unfortunately OR "not moving forward" OR assessment OR schedule OR recruiter OR role)';

// Senders that only ever send alerts, digests or marketing. An entry is a full
// address (jobalerts-noreply@linkedin.com) or a domain (totaljobs.com), which
// also covers its subdomains.
export const DEFAULT_GMAIL_SKIP_SENDERS = [
  "jobalerts-noreply@linkedin.com", "jobs-listings@linkedin.com", "jobs-noreply@linkedin.com", "messages-noreply@linkedin.com",
  "notifications-noreply@linkedin.com", "newsletters-noreply@linkedin.com", "totaljobs.com", "cwjobs.co.uk", "reed.co.uk",
  "jobsite.co.uk", "alert.indeed.com", "indeedemail.com", "match.indeed.com", "glassdoor.com", "otta.com",
  "welcometothejungle.com", "hired.com", "wellfound.com", "angel.co", "cv-library.co.uk", "monster.co.uk", "adzuna.co.uk",
  "jobgether.com", "substack.com", "medium.com",
];

export const DEFAULT_GMAIL_CHECK = {
  enabled: false,
  query: DEFAULT_GMAIL_QUERY,
  maxMessages: 40,
  skipSenders: DEFAULT_GMAIL_SKIP_SENDERS,
};

export const DEFAULT_EMAIL_STATUS = {
  enabled: false,
  minimumConfidence: 0.6,
  gmailCheck: DEFAULT_GMAIL_CHECK,
};

export const EMAIL_STATUS_CONFIDENCE_MIN = 0.3;
export const EMAIL_STATUS_CONFIDENCE_MAX = 0.99;
export const GMAIL_MAX_MESSAGES = 100;
const SKIP_SENDER = /^([^@\s]+@)?[a-z0-9-]+(\.[a-z0-9-]+)+$/;

const invalid = () => Object.assign(new Error("Publish valid email status proposal settings in Sanity."),
  { status: 503, code: "SANITY_SETTINGS_INVALID" });

function validateGmailCheck(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value) || typeof value.enabled !== "boolean"
    || typeof value.query !== "string" || !value.query.trim() || value.query.length > 500 || /[\u0000-\u001f]/.test(value.query)
    || !Number.isInteger(value.maxMessages) || value.maxMessages < 1 || value.maxMessages > GMAIL_MAX_MESSAGES
    || !Array.isArray(value.skipSenders) || value.skipSenders.length > 200
    || !value.skipSenders.every(entry => typeof entry === "string" && SKIP_SENDER.test(entry.trim().toLowerCase()))) throw invalid();
  return { enabled: value.enabled, query: value.query.trim(), maxMessages: value.maxMessages,
    skipSenders: value.skipSenders.map(entry => entry.trim().toLowerCase()) };
}

export function validateEmailStatus(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.enabled !== "boolean"
    || typeof value.minimumConfidence !== "number" || !Number.isFinite(value.minimumConfidence)
    || value.minimumConfidence < EMAIL_STATUS_CONFIDENCE_MIN || value.minimumConfidence > EMAIL_STATUS_CONFIDENCE_MAX) throw invalid();
  return { enabled: value.enabled, minimumConfidence: value.minimumConfidence, gmailCheck: validateGmailCheck(value.gmailCheck) };
}
