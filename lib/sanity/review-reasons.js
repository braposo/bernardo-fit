// Seed/offline values only. Hosted reviews read the published `reviewReasons`
// object; while it is unpublished the admin offers only reasons learned from
// earlier review decisions.
export const DEFAULT_REVIEW_REASONS = {
  advance: ["Strong management fit", "Right stack", "Location works", "Interesting product", "Good salary"],
  drop: ["Too hands-on", "Not a management role", "Commute or office days", "Salary too low", "Wrong seniority",
    "Industry not a fit", "Agency or duplicate"],
};

export const REVIEW_REASON_MAX_LENGTH = 60;
export const REVIEW_REASONS_PER_LIST = 12;

const invalid = () => Object.assign(new Error("Publish valid review reasons in Sanity."),
  { status: 503, code: "SANITY_SETTINGS_INVALID" });

function list(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > REVIEW_REASONS_PER_LIST) throw invalid();
  const seen = new Set();
  return value.map(item => {
    if (typeof item !== "string") throw invalid();
    const reason = item.trim();
    const key = reason.toLowerCase();
    if (!reason || reason.length > REVIEW_REASON_MAX_LENGTH || seen.has(key)) throw invalid();
    seen.add(key);
    return reason;
  });
}

export function validateReviewReasons(value) {
  if (!value || typeof value !== "object") throw invalid();
  return { advance: list(value.advance), drop: list(value.drop) };
}
