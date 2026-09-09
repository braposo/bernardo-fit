import { createHash } from "node:crypto";

export function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function researchFingerprint(job) {
  return digest({
    company: String(job.company || "").trim(),
    role: String(job.role || "").trim(),
    domain: safeDomain(job.sourceUrl),
  });
}

export function briefFingerprint(job, report, research) {
  return digest({
    jobId: job.id,
    reportId: job.fitReportId,
    report: digest(report),
    researchId: research?.id || "",
    research: digest(research || {}),
    posting: String(job.jobDescription || ""),
    notes: String(job.notes || ""),
    instructions: String(job.instructions || ""),
    questions: job.questions || [],
    salary: String(job.salary || ""),
    location: String(job.location || ""),
    locationMode: String(job.locationMode || ""),
    stage: "screen",
  });
}

function safeDomain(value) {
  try { return new URL(String(value || "")).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
}

export function coverFingerprint(job, report, model) {
  return digest({
    jobId: job.id,
    reportId: job.fitReportId,
    report: digest(report),
    instructions: String(job.instructions || "").trim(),
    model,
  });
}
