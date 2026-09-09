import { idempotencyKeys, runs, tasks } from "@trigger.dev/sdk";
import { requireAdmin } from "../../lib/admin.js";
import { briefFingerprint, coverFingerprint, digest, researchFingerprint } from "../../lib/generation-fingerprint.js";
import { getJob, getReport, mutateJob } from "../../lib/store.js";
import { getActiveResearch } from "../../lib/screen-artifacts.js";
import { resolveModel, PUBLIC_MODEL } from "../../lib/models.js";
import { researchIsReusable } from "../../lib/screen-work.js";
import { getReceiptForRequest, getRunReceipt, saveRunReceipt } from "../../lib/run-receipts.js";
import { BRIEF_TASK_ID, COVER_TASK_ID, PREPARE_SCREEN_TASK_ID, RESEARCH_TASK_ID,
  TERMINAL_RUN_STATUSES, coverDispatchEnabled, screenDispatchEnabled } from "../../lib/task-policy.js";

const SPECS = {
  cover: { taskId: COVER_TASK_ID, field: "coverRun" },
  research: { taskId: RESEARCH_TASK_ID, field: "researchRun" },
  brief: { taskId: BRIEF_TASK_ID, field: "briefRun" },
  "prepare-screen": { taskId: PREPARE_SCREEN_TASK_ID, field: "prepareRun" },
};
const validRequestId = (value) => /^[a-zA-Z0-9_-]{8,100}$/.test(String(value || "")) ? String(value) : "";
const origin = () => (process.env.PUBLIC_BASE_URL || "https://fit.bernardoraposo.com").replace(/\/$/, "");

async function context(kind, job, model) {
  const report = job.fitReportId ? await getReport(job.fitReportId) : null;
  if ((kind === "cover" || kind === "brief" || kind === "prepare-screen") && !report) {
    throw Object.assign(new Error("Generate the fit analysis first; this work is built from it."), { status: 409 });
  }
  if (kind === "cover") return { fingerprint: coverFingerprint(job, report, model), payload: { model, origin: origin() } };
  if (kind === "research") return { fingerprint: researchFingerprint(job), payload: { model: PUBLIC_MODEL } };
  const research = await getActiveResearch(job);
  if (kind === "brief" && !researchIsReusable(job, research)) {
    throw Object.assign(new Error("Refresh the company research before rewriting the brief."), { status: 409 });
  }
  if (kind === "brief") return { fingerprint: briefFingerprint(job, report, research), payload: { model } };
  return {
    fingerprint: digest({ research: researchFingerprint(job), brief: briefFingerprint(job, report, research || {}), model }),
    payload: { model },
  };
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
      if (terminal && run.status !== "COMPLETED") await mutateJob(receipt.jobId, (current) =>
        current[spec.field]?.runId === receipt.runId && current[spec.field].status !== "failed"
          ? { [spec.field]: { ...current[spec.field], status: "failed", finishedAt: new Date().toISOString() } } : undefined);
      return res.status(200).json({
        kind: receipt.kind, runId: run.id, jobId: receipt.jobId, requestId: receipt.requestId,
        status: run.status, terminal, phase: run.metadata?.phase || (run.status === "COMPLETED" ? "completed" : "queued"),
        ...(run.status === "COMPLETED" && run.output ? { result: run.output } : {}),
        ...(terminal && run.status !== "COMPLETED" ? { error: run.error?.message || "Background work failed." } : {}),
      });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const { id } = req.body || {};
    const kind = String(req.body?.kind || "cover");
    const spec = SPECS[kind];
    const requestId = validRequestId(req.body?.requestId);
    if (!id || !requestId || !spec) return res.status(400).json({ error: "Missing id, valid kind, or valid requestId" });
    const recovered = await getReceiptForRequest(kind, id, requestId);
    if (recovered) return res.status(202).json({ runId: recovered.runId, requestId, kind, recovered: true });
    if (kind === "cover" ? !coverDispatchEnabled() : !screenDispatchEnabled()) return res.status(503).json({ error: "This generation is temporarily paused." });
    const job = await getJob(id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    const model = resolveModel(req.body?.model);
    const built = await context(kind, job, model);
    const startedAt = new Date().toISOString();
    await mutateJob(id, () => ({ [spec.field]: {
      requestId, runId: "", fingerprint: built.fingerprint, status: "dispatching", startedAt, finishedAt: "",
    } }));
    try {
      const key = await idempotencyKeys.create(`${kind}:${id}:${requestId}`, { scope: "global" });
      const handle = await tasks.trigger(spec.taskId, {
        jobId: id, requestId, fingerprint: built.fingerprint, ...built.payload,
        ...(kind === "prepare-screen" ? { forceResearch: !!req.body.forceResearch } : {}),
      }, { idempotencyKey: key, idempotencyKeyTTL: "30d", tags: [`job:${id}`, `request:${requestId}`] });
      await saveRunReceipt({ kind, requestId, runId: handle.id, jobId: id, fingerprint: built.fingerprint });
      await mutateJob(id, (current) => current[spec.field]?.requestId === requestId
        ? { [spec.field]: { ...current[spec.field], runId: handle.id,
          status: ["completed", "superseded"].includes(current[spec.field].status) ? current[spec.field].status : "queued" } } : undefined);
      return res.status(202).json({ runId: handle.id, requestId, kind, recovered: false });
    } catch (error) {
      await mutateJob(id, (current) => current[spec.field]?.requestId === requestId
        ? { [spec.field]: { ...current[spec.field], status: "dispatch_failed", finishedAt: new Date().toISOString() } } : undefined);
      throw error;
    }
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Unexpected error", detail: err.detail });
  }
}
