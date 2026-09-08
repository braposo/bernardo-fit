// Public reads and prompt inputs must not import the generator or its profile.
const TEXT_FIELDS = ["job_title", "company", "pitch", "closing"];

export function publicReport(value) {
  const report = value && typeof value === "object" ? value : {};
  const out = {};
  for (const key of TEXT_FIELDS) if (typeof report[key] === "string") out[key] = report[key];
  out.categories = Array.isArray(report.categories)
    ? report.categories.map(c => ({ name: String(c?.name || ""), note: String(c?.note || "") })) : [];
  out.differentiators = Array.isArray(report.differentiators)
    ? report.differentiators.map(d => ({ headline: String(d?.headline || ""), detail: String(d?.detail || "") })) : [];
  for (const key of ["created_at", "regenerated_at", "model"]) {
    if (typeof report[key] === "string") out[key] = report[key];
  }
  return out;
}

export function reportEvidence(report) {
  const { created_at, regenerated_at, model, ...evidence } = publicReport(report);
  return evidence;
}
