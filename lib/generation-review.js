import { normaliseVersionInstructions, withVersionInstructions } from "./version-instructions.js";
import { analysisFingerprint, answerFingerprint, briefFingerprint, coverFingerprint, digest, researchFingerprint } from "./generation-fingerprint.js";
import { getJob, getReport, listJobs } from "./store.js";
import { getActiveResearch } from "./screen-artifacts.js";
import { resolveModel } from "./models.js";
import { researchIsReusable } from "./screen-work.js";
import { JEV_MODEL, jevEnabled } from "./jev.js";
import { scoringFingerprint } from "./jev-scoring.js";

export const REVIEWED_GENERATION_KINDS = new Set([
  "cover", "research", "brief", "prepare-screen", "analyse", "regenerate", "answer", "analyse-all", "jev-score",
]);

const conflict = (message, code = "REVIEW_STALE") =>
  Object.assign(new Error(message), { status: 409, code });

const subject = (job) => [job?.company, job?.role].filter(Boolean).join(" · ") || "Untitled role";

export function prepareBaseFingerprint(job, report, model, researchAction, research) {
  return digest({
    kind: "prepare-screen",
    model,
    researchAction,
    researchInput: researchFingerprint(job),
    briefInput: briefFingerprint(job, report, researchAction === "reuse" ? research : null),
    researchId: researchAction === "reuse" ? research?.id || "" : "",
  });
}

function reviewCopy(kind, job, { researchAction = "none", count = 0 } = {}) {
  const common = { subject: subject(job), costEstimate: null,
    costText: "A reliable estimate is unavailable. This action may incur AI costs." };
  const hasLetter = !!(job?.hasCoverLetter || job?.coverLetterId || job?.coverLetter);
  const hasBrief = !!(job?.hasBrief || job?.briefId);
  if (kind === "jev-score") return { ...common, title: "Assess fit with Jev", submitLabel: "Assess fit",
    steps: ["Score five fit dimensions against your profile and saved preferences", "Check posting quality and explicit hard constraints"],
    publication: "The private assessment updates pipeline scoring. Public reports stay unchanged." };
  if (kind === "cover") return { ...common, title: hasLetter ? "Rewrite cover letter" : "Generate cover letter",
    submitLabel: hasLetter ? "Rewrite letter" : "Generate letter", steps: ["Write a cover letter from the saved fit analysis and role context"],
    publication: "The current letter stays readable while work runs. The completed letter becomes active and the previous letter remains in version history." };
  if (kind === "analyse") return { ...common, title: "Generate fit analysis", submitLabel: "Generate analysis",
    steps: ["Assess the saved job description against the profile"],
    publication: "The completed analysis becomes the role's active fit page." };
  if (kind === "regenerate") return { ...common, title: "Regenerate fit analysis", submitLabel: "Regenerate analysis",
    steps: ["Reassess the saved job description against the profile"],
    publication: "The completed version becomes active on the existing shared fit page. Other roles linked to that page are updated too." };
  if (kind === "research") return { ...common, title: "Refresh company research", submitLabel: "Refresh research",
    steps: ["Research the company using current web sources"],
    publication: "The current research stays readable while work runs. The completed research becomes active and may make the interview brief outdated." };
  if (kind === "brief") return { ...common, title: hasBrief ? "Rewrite interview brief" : "Generate interview brief",
    submitLabel: hasBrief ? "Rewrite brief" : "Generate brief", steps: ["Reuse the current company research", "Write an interview brief from saved role context"],
    publication: "The current brief stays readable while work runs. The completed brief becomes active." };
  if (kind === "prepare-screen") return { ...common, title: hasBrief ? "Rewrite interview brief" : "Generate interview brief",
    submitLabel: "Refresh research & " + (hasBrief ? "rewrite brief" : "generate brief"),
    steps: ["Refresh company research", hasBrief ? "Write a new interview brief" : "Write an interview brief"],
    publication: "The current research and brief stay readable while work runs. Completed outputs become active." };
  if (kind === "answer") return { ...common, title: "Draft application answer", submitLabel: "Draft answer",
    steps: ["Draft an answer to the saved application question"],
    publication: "The completed draft replaces the saved answer for this question and may make the interview brief outdated." };
  return { ...common, subject: count + " role" + (count === 1 ? "" : "s"), title: "Analyse selected roles",
    submitLabel: "Analyse " + count + " role" + (count === 1 ? "" : "s"),
    steps: ["Generate a fit analysis for each listed role"],
    publication: "Each completed analysis becomes that role's active fit page. Newly eligible roles are not included." };
}

function inputSummary(kind, job, body) {
  if (kind === "jev-score") return "Candidate profile, saved job description, location, working arrangement, salary and AI instructions.";
  if (kind === "answer") {
    const question = (job.questions || []).find((item) => item.id === String(body.questionId || ""));
    return `Saved question (${question?.limit || 120} word limit), job description, fit analysis, prior answers and AI instructions.`;
  }
  if (kind === "research") return "Saved company, role and source website.";
  if (kind === "analyse" || kind === "regenerate") return "Saved job description and AI instructions.";
  return "Saved job description, fit analysis, private notes and AI instructions.";
}

export async function resolveGenerationReview(body = {}) {
  const requestedKind = String(body.kind || "cover");
  if (!REVIEWED_GENERATION_KINDS.has(requestedKind)) throw Object.assign(new Error("Unknown generation kind"), { status: 400 });
  const model = requestedKind === "jev-score" ? JEV_MODEL : resolveModel(body.model);
  if (requestedKind === "jev-score" && !jevEnabled()) throw Object.assign(new Error("Enable Jev and configure AI_GATEWAY_API_KEY in Vercel and Trigger.dev."), { status: 503 });
  const versionInstructions = normaliseVersionInstructions(body.versionInstructions);
  if (versionInstructions && !["analyse", "regenerate", "cover", "research", "brief", "prepare-screen"].includes(requestedKind)) {
    throw Object.assign(new Error("Version instructions are only supported for individual documents."), { status: 400 });
  }

  if (requestedKind === "analyse-all") {
    const eligible = (await listJobs())
      .filter((job) => !job.fitReportId && String(job.jobDescription || "").trim().length >= 20)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((job) => ({ id: job.id, company: job.company || "", role: job.role || "",
        fingerprint: analysisFingerprint(job, model) }));
    if (!eligible.length) throw conflict("There are no roles ready for analysis.", "NOTHING_TO_ANALYSE");
    const workFingerprint = digest({ kind: requestedKind, model, jobs: eligible.map(({ id, fingerprint }) => ({ id, fingerprint })) });
    const fingerprint = digest({ kind: requestedKind, model, scope: workFingerprint });
    return { kind: requestedKind, model, fingerprint, workFingerprint, payload: { model, jobs: eligible.map(({ id, fingerprint }) => ({ id, fingerprint })) },
      review: { kind: requestedKind, effectiveKind: requestedKind, model, fingerprint, jobs: eligible,
        inputSummary: "The exact roles listed below, using each saved job description and AI instructions.",
        ...reviewCopy(requestedKind, null, { count: eligible.length }) } };
  }

  const job = withVersionInstructions(await getJob(String(body.id || "")), versionInstructions);
  if (!job) throw Object.assign(new Error("Job not found"), { status: 404 });
  const reportId = body.reportId || job.fitReportId || "";
  const report = reportId ? await getReport(reportId) : null;
  if (["cover", "brief", "prepare-screen", "regenerate"].includes(requestedKind) && !report) {
    throw conflict("Generate the fit analysis first; this work is built from it.", "MISSING_ANALYSIS");
  }

  let kind = requestedKind;
  let fingerprint;
  let payload = { model };
  let researchAction = "none";

  if (kind === "jev-score") {
    if (job.archived) throw conflict("Restore this role before assessing it.");
    if (String(job.jobDescription || "").trim().length < 20) throw conflict("Add a fuller job description first.", "MISSING_DESCRIPTION");
    fingerprint = scoringFingerprint(job);
  } else if (kind === "cover") fingerprint = coverFingerprint(job, report, model);
  else if (kind === "research") fingerprint = researchFingerprint(job);
  else if (kind === "analyse") {
    if (String(job.jobDescription || "").trim().length < 20) throw conflict("Add a fuller job description first.", "MISSING_DESCRIPTION");
    fingerprint = analysisFingerprint(job, model); payload.mode = "create";
  } else if (kind === "regenerate") {
    if (job.fitReportId !== reportId) throw conflict("This analysis does not belong to that role.", "ANALYSIS_MISMATCH");
    fingerprint = analysisFingerprint(job, model, "replace", report); payload = { model, mode: "replace", reportId };
  } else if (kind === "answer") {
    const questionId = String(body.questionId || "");
    const question = (job.questions || []).find((item) => item.id === questionId);
    if (!question) throw Object.assign(new Error("Question not found"), { status: 404 });
    if (!String(question.q || "").trim()) throw conflict("Write the question first.", "MISSING_QUESTION");
    const economy = body.economy === true;
    fingerprint = answerFingerprint(job, questionId, model, report, { economy });
    payload = { model, questionId, economy };
  } else {
    const research = await getActiveResearch(job);
    const reusable = researchIsReusable(job, research, Date.now(), model);
    if (requestedKind === "prepare-screen" && reusable && body.forceResearch !== true) kind = "brief";
    if (kind === "brief") {
      if (!reusable) throw conflict("Company research changed or is outdated. Refresh the generation review.");
      researchAction = "reuse";
      fingerprint = briefFingerprint(job, report, research);
    } else {
      researchAction = "refresh";
      fingerprint = prepareBaseFingerprint(job, report, model, researchAction, research);
      payload = { model, researchAction };
    }
  }

  payload.versionInstructions = versionInstructions;
  const workFingerprint = fingerprint;
  fingerprint = digest({ kind, model, scope: workFingerprint, questionId: payload.questionId || "", economy: payload.economy === true,
    researchAction });
  return { kind, model, fingerprint, workFingerprint, payload, job,
    review: { kind: requestedKind, effectiveKind: kind, model, fingerprint, researchAction,
      inputSummary: inputSummary(kind, job, body), ...reviewCopy(kind, job, { researchAction }) } };
}

export function assertReviewedScope(body, resolved) {
  if (!body.reviewFingerprint || body.reviewFingerprint !== resolved.fingerprint || String(body.kind || "cover") !== resolved.kind) {
    throw conflict("The role or generation scope changed. Refresh the review before submitting.");
  }
}
