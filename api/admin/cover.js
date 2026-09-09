import { idempotencyKeys, runs, tasks } from "@trigger.dev/sdk";
import { requireAdmin } from "../../lib/admin.js";
import { analysisFingerprint, answerFingerprint, briefFingerprint, coverFingerprint, digest, researchFingerprint } from "../../lib/generation-fingerprint.js";
import { getJob, getReport, mutateJob } from "../../lib/store.js";
import { getActiveResearch } from "../../lib/screen-artifacts.js";
import { resolveModel, PUBLIC_MODEL } from "../../lib/models.js";
import { researchIsReusable } from "../../lib/screen-work.js";
import { clearActiveRun, getReceiptForRequest, getRunReceipt, saveActiveRun, saveRunReceipt } from "../../lib/run-receipts.js";
import { ADOPT_TASK_ID, ANALYSIS_TASK_ID, ANALYSE_ALL_TASK_ID, ANSWER_TASK_ID, BRIEF_TASK_ID,
  COVER_TASK_ID, PREPARE_SCREEN_TASK_ID, RESEARCH_TASK_ID, TERMINAL_RUN_STATUSES,
  coverDispatchEnabled, screenDispatchEnabled } from "../../lib/task-policy.js";

const SPECS = {
  cover: { taskId: COVER_TASK_ID, field: "coverRun" },
  research: { taskId: RESEARCH_TASK_ID, field: "researchRun" },
  brief: { taskId: BRIEF_TASK_ID, field: "briefRun" },
  "prepare-screen": { taskId: PREPARE_SCREEN_TASK_ID, field: "prepareRun" },
  analyse: { taskId: ANALYSIS_TASK_ID, field: "analysisRun" },
  regenerate: { taskId: ANALYSIS_TASK_ID, field: "analysisRun" },
  answer: { taskId: ANSWER_TASK_ID, field: "questionRun" },
  "analyse-all": { taskId: ANALYSE_ALL_TASK_ID, global: true },
  adopt: { taskId: ADOPT_TASK_ID, global: true },
  ingest: { taskId: null, global: true, statusOnly: true },
};
const validRequestId = (value) => /^[a-zA-Z0-9_-]{8,100}$/.test(String(value || "")) ? String(value) : "";
const origin = () => (process.env.PUBLIC_BASE_URL || "https://fit.bernardoraposo.com").replace(/\/$/, "");
const finished = () => new Date().toISOString();

async function buildContext(kind, job, body, model) {
  const reportId = body.reportId || job?.fitReportId || "";
  const report = reportId ? await getReport(reportId) : null;
  if (["cover", "brief", "prepare-screen", "regenerate"].includes(kind) && !report) {
    throw Object.assign(new Error("Generate the fit analysis first; this work is built from it."), { status: 409 });
  }
  if (kind === "cover") return { fingerprint: coverFingerprint(job, report, model), payload: { model, origin: origin() } };
  if (kind === "research") return { fingerprint: researchFingerprint(job), payload: { model: PUBLIC_MODEL } };
  if (kind === "analyse") {
    if (String(job.jobDescription || "").trim().length < 20) {
      throw Object.assign(new Error("Add a fuller job description first."), { status: 409 });
    }
    return { fingerprint: analysisFingerprint(job, model), payload: { model, mode: "create" } };
  }
  if (kind === "regenerate") {
    if (job.fitReportId !== reportId) throw Object.assign(new Error("This analysis does not belong to that role."), { status: 409 });
    return { fingerprint: analysisFingerprint(job, model, "replace", report),
    payload: { model, mode: "replace", reportId } };
  }
  if (kind === "answer") {
    const questionId = String(body.questionId || "");
    const question = (job.questions || []).find((item) => item.id === questionId);
    if (!question) {
      throw Object.assign(new Error("Question not found"), { status: 404 });
    }
    if (!String(question.q || "").trim()) throw Object.assign(new Error("Write the question first."), { status: 409 });
    return { fingerprint: answerFingerprint(job, questionId, model, report), payload: { model, questionId } };
  }
  const research = await getActiveResearch(job);
  if (kind === "brief" && !researchIsReusable(job, research)) {
    throw Object.assign(new Error("Refresh the company research before rewriting the brief."), { status: 409 });
  }
  if (kind === "brief") return { fingerprint: briefFingerprint(job, report, research), payload: { model } };
  return { fingerprint: digest({ research: researchFingerprint(job), brief: briefFingerprint(job, report, research || {}), model }),
    payload: { model, ...(kind === "prepare-screen" ? { forceResearch: !!body.forceResearch } : {}) } };
}

async function writeRun(jobId, spec, body, run) {
  if (spec.global) return;
  await mutateJob(jobId, (current) => {
    if (spec.field === "questionRun") {
      return { questions: (current.questions || []).map((q) => q.id === body.questionId ? { ...q, run } : q) };
    }
    return { [spec.field]: run };
  });
}

async function failRun(receipt, spec) {
  if (spec.global) return;
  await mutateJob(receipt.jobId, (current) => {
    if (spec.field === "questionRun") return { questions: (current.questions || []).map((q) =>
      q.id === receipt.questionId && q.run?.runId === receipt.runId && q.run.status !== "failed"
        ? { ...q, run: { ...q.run, status: "failed", finishedAt: finished() } } : q) };
    return current[spec.field]?.runId === receipt.runId && current[spec.field].status !== "failed"
      ? { [spec.field]: { ...current[spec.field], status: "failed", finishedAt: finished() } } : undefined;
  });
}

async function restoreRunPointer(receipt, spec) {
  if (spec.global) return;
  await mutateJob(receipt.jobId, (current) => {
    if (spec.field === "questionRun") return { questions: (current.questions || []).map((q) =>
      q.id === receipt.questionId && q.run?.requestId === receipt.requestId
        ? { ...q, run: { ...q.run, runId: receipt.runId, status: "queued" } } : q) };
    return current[spec.field]?.requestId === receipt.requestId
      ? { [spec.field]: { ...current[spec.field], runId: receipt.runId, status: "queued" } } : undefined;
  });
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (req.method === "GET") {
      const receipt = await getRunReceipt(String(req.query?.run || ""));
      const spec = receipt && SPECS[receipt.kind];
      if (!receipt || !spec) return res.status(404).json({ error: "Run not found" });
      const run = await runs.retrieve(receipt.runId);
      const terminal = TERMINAL_RUN_STATUSES.has(run.status);
      if (terminal && run.status !== "COMPLETED") await failRun(receipt, spec);
      if (terminal && spec.global) await clearActiveRun(receipt.kind, receipt.runId);
      return res.status(200).json({ kind: receipt.kind, runId: run.id, jobId: receipt.jobId,
        requestId: receipt.requestId, status: run.status, terminal,
        phase: run.metadata?.phase || (run.status === "COMPLETED" ? "completed" : "queued"),
        ...(run.status === "COMPLETED" && run.output ? { result: run.output } : {}),
        ...(terminal && run.status !== "COMPLETED" ? { error: run.error?.message || "Background work failed." } : {}),
      });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const body = req.body || {};
    const kind = String(body.kind || "cover");
    const spec = SPECS[kind];
    const requestId = validRequestId(body.requestId);
    const ownerId = spec?.global ? "batch" : String(body.id || "");
    if (!requestId || !spec || !ownerId) return res.status(400).json({ error: "Missing id, valid kind, or valid requestId" });
    if (spec.statusOnly) return res.status(400).json({ error: "This work starts from its dedicated input endpoint." });
    const recovered = await getReceiptForRequest(kind, ownerId, requestId);
    if (recovered) {
      await restoreRunPointer(recovered, spec);
      return res.status(202).json({ runId: recovered.runId, requestId, kind, recovered: true });
    }
    if (kind === "cover" && !coverDispatchEnabled()) return res.status(503).json({ error: "This generation is temporarily paused." });
    if (["research", "brief", "prepare-screen"].includes(kind) && !screenDispatchEnabled()) {
      return res.status(503).json({ error: "This generation is temporarily paused." });
    }
    const job = spec.global ? null : await getJob(ownerId);
    if (!spec.global && !job) return res.status(404).json({ error: "Job not found" });
    const model = resolveModel(body.model);
    const built = spec.global
      ? { fingerprint: digest({ kind, requestId, model }), payload: { model } }
      : await buildContext(kind, job, body, model);
    const startedAt = new Date().toISOString();
    const pendingRun = { requestId, runId: "", fingerprint: built.fingerprint,
      status: "dispatching", startedAt, finishedAt: "" };
    await writeRun(ownerId, spec, body, pendingRun);
    try {
      const key = await idempotencyKeys.create(`${kind}:${ownerId}:${requestId}`, { scope: "global" });
      const handle = await tasks.trigger(spec.taskId, { jobId: ownerId, requestId, fingerprint: built.fingerprint,
        ...built.payload }, { idempotencyKey: key, idempotencyKeyTTL: "30d",
        tags: [`${spec.global ? "batch" : "job"}:${ownerId}`, `request:${requestId}`] });
      const receipt = await saveRunReceipt({ kind, requestId, runId: handle.id, jobId: ownerId,
        fingerprint: built.fingerprint, ...(kind === "answer" ? { questionId: body.questionId } : {}) });
      if (spec.global) await saveActiveRun(kind, receipt);
      await writeRun(ownerId, spec, body, { ...pendingRun, runId: handle.id, status: "queued" });
      return res.status(202).json({ runId: handle.id, requestId, kind, recovered: false });
    } catch (error) {
      await writeRun(ownerId, spec, body, { ...pendingRun, status: "dispatch_failed", finishedAt: finished() });
      throw error;
    }
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Unexpected error", detail: error.detail });
  }
}
