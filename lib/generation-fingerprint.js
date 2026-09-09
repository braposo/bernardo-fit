import { createHash } from "node:crypto";

export function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function researchFingerprint(job) {
  return digest({
    company: String(job.company || "").trim(),
    role: String(job.role || "").trim(),
    domain: companyDomain(job.sourceUrl),
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

export function analysisFingerprint(job, model, mode = "create", report = null) {
  return digest({
    mode, jobId: job?.id || "", reportId: job?.fitReportId || "",
    posting: String(job?.jobDescription || report?.job_description || "").trim(),
    instructions: String(job?.instructions || "").trim(), model,
    ...(mode === "replace" ? { report: digest(report || {}) } : {}),
  });
}

export function answerFingerprint(job, questionId, model, report = null) {
  const questions = job?.questions || [];
  const index = questions.findIndex((q) => q.id === questionId);
  const target = questions[index] || {};
  return digest({
    jobId: job?.id || "", questionId, question: target.q || "", limit: target.limit,
    prior: questions.slice(0, Math.max(index, 0)).filter((q) => q.a && !q.refused).map((q) => ({ q: q.q, a: q.a })),
    posting: String(job?.jobDescription || ""), instructions: String(job?.instructions || ""),
    report: digest(report || {}), model,
  });
}

export function companyDomain(value) {
  try {
    const host = new URL(String(value || "")).hostname.replace(/^www\./, "").toLowerCase();
    const jobHosts = ["linkedin.com", "indeed.com", "otta.com", "welcome-to-the-jungle.com", "welcometothejungle.com",
      "greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "smartrecruiters.com"];
    return jobHosts.some((x) => host === x || host.endsWith("." + x)) ? "" : host;
  }
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
