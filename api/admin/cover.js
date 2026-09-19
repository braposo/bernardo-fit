import { idempotencyKeys, runs, tasks } from "@trigger.dev/sdk";
import { requireAdmin } from "../../lib/admin.js";
import { digest } from "../../lib/generation-fingerprint.js";
import { assertReviewedScope, resolveGenerationReview, REVIEWED_GENERATION_KINDS } from "../../lib/generation-review.js";
import { getJob, mutateJob } from "../../lib/store.js";
import { resolveModel } from "../../lib/models.js";
import { clearActiveRun, getReceiptForRequest, getRunReceipt, saveActiveRun, saveRunReceipt } from "../../lib/run-receipts.js";
import { ADOPT_TASK_ID, ANALYSIS_TASK_ID, ANALYSE_ALL_TASK_ID, ANSWER_TASK_ID, BRIEF_TASK_ID,
  COVER_TASK_ID, PREPARE_SCREEN_TASK_ID, RESEARCH_TASK_ID, TERMINAL_RUN_STATUSES,
  coverDispatchEnabled, screenDispatchEnabled } from "../../lib/task-policy.js";

const SPECS = {
  "jev-score": { taskId: "jev-score", field: "jevRun" },
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

async function writeRun(jobId, spec, body, run) {
  if (spec.global) return;
  await mutateJob(jobId, (current) => {
    if (spec.field === "questionRun") {
      return { questions: (current.questions || []).map((q) => q.id === body.questionId && q.run?.requestId === run.requestId &&
        !(run.status === "queued" && ["completed", "superseded", "failed"].includes(q.run?.status)) ? { ...q, run } : q) };
    }
    return current[spec.field]?.requestId === run.requestId &&
      !(run.status === "queued" && ["completed", "superseded", "failed"].includes(current[spec.field]?.status)) ? { [spec.field]: run } : undefined;
  });
}

// The winning request ID is the provider idempotency key. Two browser requests
// for identical in-flight work therefore dispatch/recover the same child task.
// Completed runs remain eligible for a deliberate rewrite with a new request ID.
export async function claimRun(jobId, spec, body, pending) {
  if (spec.global) return pending;
  let selected = pending;
  await mutateJob(jobId, current => {
    const previous = spec.field === "questionRun"
      ? current.questions?.find(q => q.id === body.questionId)?.run : current[spec.field];
    if (previous?.model === pending.model && previous?.fingerprint === pending.fingerprint && ["dispatching", "queued"].includes(previous.status)) {
      selected = previous;
      return undefined;
    }
    selected = pending;
    return spec.field === "questionRun"
      ? { questions: (current.questions || []).map(q => q.id === body.questionId ? { ...q, run: pending } : q) }
      : { [spec.field]: pending };
  });
  return selected;
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
      q.id === receipt.questionId && q.run?.requestId === receipt.requestId && !["completed", "superseded", "failed"].includes(q.run?.status)
        ? { ...q, run: { ...q.run, runId: receipt.runId, status: "queued" } } : q) };
    return current[spec.field]?.requestId === receipt.requestId && !["completed", "superseded", "failed"].includes(current[spec.field]?.status)
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
    if (body.action === "review") {
      const resolved = await resolveGenerationReview(body);
      return res.status(200).json({ review: resolved.review });
    }
    const kind = String(body.kind || "cover");
    const spec = SPECS[kind];
    let requestId = validRequestId(body.requestId);
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
    let resolved = null;
    if (REVIEWED_GENERATION_KINDS.has(kind)) {
      resolved = await resolveGenerationReview(body);
      assertReviewedScope(body, resolved);
    }
    const job = spec.global ? null : (resolved?.job || await getJob(ownerId));
    if (!spec.global && !job) return res.status(404).json({ error: "Job not found" });
    const model = resolved?.model || resolveModel(body.model);
    const built = resolved
      ? { fingerprint: resolved.workFingerprint, payload: { ...resolved.payload, ...(kind === "cover" ? { origin: origin() } : {}) } }
      : { fingerprint: digest({ kind, requestId, model }), payload: { model } };
    const prior = spec.field === "questionRun" ? job?.questions?.find(q => q.id === body.questionId)?.run : job?.[spec.field];
    if (prior?.runId && prior.fingerprint === built.fingerprint && ["dispatching", "queued"].includes(prior.status)) {
      const currentRun = await runs.retrieve(prior.runId);
      if (TERMINAL_RUN_STATUSES.has(currentRun.status)) {
        await writeRun(ownerId, spec, body, { ...prior, status: currentRun.status === "COMPLETED" ? "completed" : "failed", finishedAt: finished() });
      }
    }
    const startedAt = new Date().toISOString();
    let pendingRun = { requestId, runId: "", model, fingerprint: built.fingerprint,
      status: "dispatching", startedAt, finishedAt: "" };
    pendingRun = await claimRun(ownerId, spec, body, pendingRun);
    requestId = pendingRun.requestId;
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
      // The service may have accepted the task before the connection failed.
      // Keep the claimed ID so a retry recovers through the same idempotency key.
      throw error;
    }
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Unexpected error", ...(error.code ? { code: error.code } : {}), detail: error.detail });
  }
}
