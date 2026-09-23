import { settingsFingerprint } from "./sanity/analysis-settings.js";
import { normaliseVersionInstructions, withVersionInstructions } from "./version-instructions.js";
import { analysisFingerprint, answerFingerprint, briefFingerprint, coverFingerprint, digest, researchFingerprint } from "./generation-fingerprint.js";
import { getJob, getReport, listJobs } from "./store.js";
import { getActiveResearch } from "./screen-artifacts.js";
import { resolveModel } from "./models.js";
import { researchIsReusable } from "./screen-work.js";
import { JEV_MODEL, jevEnabled } from "./jev.js";
import { scoringFingerprint } from "./jev-scoring.js";
import { selectWritingModel } from "./jev-model-routing.js";
import { OVERVIEW_MODEL, OVERVIEW_POLICY } from "./overview-summary.js";

export const REVIEWED_GENERATION_KINDS = new Set([
  "cover", "research", "brief", "prepare-screen", "analyse", "regenerate", "answer", "jev-score-all", "jev-score",
]);

const conflict = (message, code = "REVIEW_STALE") =>
  Object.assign(new Error(message), { status: 409, code });

const subject = (job) => [job?.company, job?.role].filter(Boolean).join(" · ") || "Untitled role";

export function prepareBaseFingerprint(job, report, model, researchAction, research) {
  return digest({ settings: settingsFingerprint(),
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
  if (kind === "jev-score") return { ...common, title: "Assess fit", submitLabel: "Assess fit",
    description: "We’ll assess how well this role fits you and write a short summary of the position, your strengths and the main trade-offs.",
    publication: "The private assessment updates pipeline scoring. Public reports stay unchanged." };
  if (kind === "cover") return { ...common, title: hasLetter ? "Rewrite cover letter" : "Generate cover letter",
    submitLabel: hasLetter ? "Rewrite letter" : "Generate letter", description: hasLetter ? "We’ll write a new version of your cover letter, tailored to this role and your experience." : "We’ll write a cover letter tailored to this role and your experience.",
    publication: "The current letter stays readable while work runs. The completed letter becomes active and the previous letter remains in version history." };
  if (kind === "analyse") return { ...common, title: "Generate fit analysis", submitLabel: "Generate analysis",
    description: "We’ll create a fit page showing how your experience matches this role, including your strengths and any gaps.",
    publication: "The completed analysis becomes the role's active fit page." };
  if (kind === "regenerate") return { ...common, title: "Regenerate fit analysis", submitLabel: "Regenerate analysis",
    description: "We’ll update your fit page using the current role details and your experience, highlighting your strengths and any gaps.",
    publication: "The completed version becomes active on the existing shared fit page. Other roles linked to that page are updated too." };
  if (kind === "research") return { ...common, title: "Refresh company research", submitLabel: "Refresh research",
    description: "We’ll research the company and put together a summary using up-to-date sources.",
    publication: "The current research stays readable while work runs. The completed research becomes active and may make the interview brief outdated." };
  if (kind === "brief") return { ...common, title: hasBrief ? "Rewrite interview brief" : "Generate interview brief",
    submitLabel: hasBrief ? "Rewrite brief" : "Generate brief", description: "We’ll use the existing company research and your role details to put together an interview brief.",
    publication: "The current brief stays readable while work runs. The completed brief becomes active." };
  if (kind === "prepare-screen") return { ...common, title: hasBrief ? "Rewrite interview brief" : "Generate interview brief",
    submitLabel: "Refresh research & " + (hasBrief ? "rewrite brief" : "generate brief"),
    description: "We’ll refresh the company research, then use it and your role details to put together an interview brief.",
    publication: "The current research and brief stay readable while work runs. Completed outputs become active." };
  if (kind === "answer") return { ...common, title: "Draft application answer", submitLabel: "Draft answer",
    description: "We’ll draft an answer to this application question, drawing on your experience and the role details.",
    publication: "The completed draft replaces the saved answer for this question and may make the interview brief outdated." };
  return { ...common, subject: count + " role" + (count === 1 ? "" : "s"), title: "Assess listed roles",
    submitLabel: "Assess " + count + " role" + (count === 1 ? "" : "s"),
    description: "We’ll assess the fit of each listed role and write its private Overview summary.",
    publication: "Scores and summaries update the pipeline and Overview. Fit pages are generated separately." };
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
  let model = ["jev-score", "jev-score-all"].includes(requestedKind) ? JEV_MODEL : resolveModel(body.model);
  if (["jev-score", "jev-score-all"].includes(requestedKind) && !jevEnabled()) throw Object.assign(new Error("Configure TYPESAFE_API_KEY in Vercel and Trigger.dev to use Jev."), { status: 503 });
  const versionInstructions = normaliseVersionInstructions(body.versionInstructions);
  if (versionInstructions && !["analyse", "regenerate", "cover", "research", "brief", "prepare-screen"].includes(requestedKind)) {
    throw Object.assign(new Error("Version instructions are only supported for individual documents."), { status: 400 });
  }

  if (requestedKind === "jev-score-all") {
    const requestedIds = body.jobIds;
    if (!Array.isArray(requestedIds) || !requestedIds.length || requestedIds.length > 500 ||
        requestedIds.some((id) => typeof id !== "string" || !id || id.length > 200) ||
        new Set(requestedIds).size !== requestedIds.length) {
      throw Object.assign(new Error("Choose roles from the current list before reviewing assessment."), { status: 400 });
    }
    const selected = new Set(requestedIds);
    const candidates = (await listJobs())
      .filter((job) => selected.has(job.id) && !job.archived)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (candidates.length !== selected.size) throw conflict("The listed roles changed. Refresh the list and review again.");
    const eligible = candidates.map((job) => ({ id: job.id, company: job.company || "", role: job.role || "",
      fingerprint: scoringFingerprint(job) }));
    const workFingerprint = digest({ kind: requestedKind, model, overviewModel: OVERVIEW_MODEL, overviewPolicy: OVERVIEW_POLICY,
      jobs: eligible.map(({ id, fingerprint }) => ({ id, fingerprint })) });
    const fingerprint = digest({ kind: requestedKind, model, scope: workFingerprint });
    return { kind: requestedKind, model, fingerprint, workFingerprint, payload: { jobs: eligible.map(({ id, fingerprint }) => ({ id, fingerprint })) },
      review: { kind: requestedKind, effectiveKind: requestedKind, model, fingerprint, jobs: eligible,
        routing: null, inputSummary: "The exact roles listed below, using each saved description, practical details and AI instructions.",
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
  const routing = kind === "jev-score" ? null : await selectWritingModel({ kind, job, report,
    questionId: String(body.questionId || ""), fallback: model });
  if (routing) model = routing.model;
  let fingerprint;
  let payload = { model };
  let researchAction = "none";

  if (kind === "jev-score") {
    if (job.archived) throw conflict("Restore this role before assessing it.");

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
  payload.modelRouting = routing?.source === "jev";
  const workFingerprint = fingerprint;
  fingerprint = digest({ kind, model, scope: workFingerprint, questionId: payload.questionId || "", economy: payload.economy === true,
    researchAction, ...(kind === "jev-score" ? { overviewModel: OVERVIEW_MODEL, overviewPolicy: OVERVIEW_POLICY } : {}) });
  return { kind, model, fingerprint, workFingerprint, payload, job,
    review: { kind: requestedKind, effectiveKind: kind, model, fingerprint, researchAction, routing,
      inputSummary: inputSummary(kind, job, body), ...reviewCopy(kind, job, { researchAction }) } };
}

export function assertReviewedScope(body, resolved) {
  if (!body.reviewFingerprint || body.reviewFingerprint !== resolved.fingerprint || String(body.kind || "cover") !== resolved.kind) {
    throw conflict("The role or generation scope changed. Refresh the review before submitting.");
  }
}
