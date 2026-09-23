import { analysisSettings, settingsFingerprint } from "./sanity/analysis-settings.js";
import { createHash } from "node:crypto";
import { briefModelInput } from "./brief-inputs.js";
import { ANSWER_POLICY_VERSION } from "./answer-policy.js";
import { jevEnabled, JEV_POLICY_VERSION } from "./jev.js";

export function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function researchFingerprint(job) {
  return digest({
    settings: settingsFingerprint(),
    ...researchInputs(job),
  });
}

function researchInputs(job) {
  return {
    company: String(job.company || "").trim(),
    role: String(job.role || "").trim(),
    domain: companyDomain(job.sourceUrl),
    ...(job._versionInstructions ? { instructions: String(job.instructions || "").trim() } : {}),
  };
}

// Imported artifacts retain their original provenance. Accept the old format
// only while the published candidate and analysis settings match the baseline.
export function researchInputsAreCurrent(job) {
  return !!job.researchFingerprint && (
    job.researchFingerprint === researchFingerprint(job) ||
    analysisSettings().legacyScoringCompatible === true &&
    job.researchFingerprint === digest(researchInputs(job))
  );
}

export function briefFingerprint(job, report, research) {
  return digest({
    settings: settingsFingerprint(),
    jobId: job.id,
    reportId: job.fitReportId,
    researchId: research?.id || "",
    input: briefModelInput(job, report, research),
    instructions: String(job.instructions || "").trim(),
    policy: "screen-2026-09-09",
  });
}

export function analysisFingerprint(job, model, mode = "create", report = null) {
  return digest({
    settings: settingsFingerprint(),
    mode, jobId: job?.id || "", reportId: job?.fitReportId || "",
    posting: String(job?.jobDescription || report?.job_description || "").trim(),
    instructions: String(job?.instructions || "").trim(), model,
    ...(mode === "replace" ? { report: digest(report || {}) } : {}),
  });
}

export function answerFingerprint(job, questionId, model, report = null, { economy = false } = {}) {
  const questions = job?.questions || [];
  const index = questions.findIndex((q) => q.id === questionId);
  const target = questions[index] || {};
  return digest({
    settings: settingsFingerprint(),
    jobId: job?.id || "", questionId, question: target.q || "", limit: target.limit,
    prior: questions.slice(0, Math.max(index, 0)).filter((q) => q.a && !q.refused).map((q) => ({ q: q.q, a: q.a })),
    posting: String(job?.jobDescription || ""), instructions: String(job?.instructions || ""),
    report: digest(report || {}), model, economy: economy === true, policy: ANSWER_POLICY_VERSION,
    ...(economy && jevEnabled() ? { jevPolicy: JEV_POLICY_VERSION } : {}),
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
    settings: settingsFingerprint(),
    jobId: job.id,
    reportId: job.fitReportId,
    report: digest(report),
    instructions: String(job.instructions || "").trim(),
    model,
  });
}
