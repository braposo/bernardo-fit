import { idempotencyKeys, runs, tasks } from "@trigger.dev/sdk";
import { requireAdmin } from "../../lib/admin.js";
import { coverFingerprint } from "../../lib/generation-fingerprint.js";
import { getJob, getReport, mutateJob } from "../../lib/store.js";
import { resolveModel } from "../../lib/models.js";
import { getReceiptForRequest, getRunReceipt, saveRunReceipt } from "../../lib/run-receipts.js";
import { COVER_TASK_ID, TERMINAL_RUN_STATUSES } from "../../lib/task-policy.js";

function validRequestId(value) {
  const id = String(value || "");
  return /^[a-zA-Z0-9_-]{8,100}$/.test(id) ? id : "";
}

function publicOrigin() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  return "https://fit.bernardoraposo.com";
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  res.setHeader("Cache-Control", "private, no-store");

  try {
    if (req.method === "GET") {
      const receipt = await getRunReceipt(String(req.query?.run || ""));
      if (!receipt || receipt.kind !== "cover") return res.status(404).json({ error: "Run not found" });
      const run = await runs.retrieve(receipt.runId);
      const terminal = TERMINAL_RUN_STATUSES.has(run.status);
      if (terminal && run.status !== "COMPLETED") {
        await mutateJob(receipt.jobId, (current) => current.coverRun?.runId === receipt.runId &&
          current.coverRun.status !== "failed"
          ? { coverRun: { ...current.coverRun, status: "failed", finishedAt: new Date().toISOString() } }
          : undefined);
      }
      return res.status(200).json({
        runId: run.id,
        jobId: receipt.jobId,
        requestId: receipt.requestId,
        status: run.status,
        terminal,
        phase: run.metadata?.phase || (run.status === "COMPLETED" ? "completed" : "queued"),
        ...(run.status === "COMPLETED" && run.output ? { result: {
          outcome: run.output.outcome,
          words: run.output.words || 0,
          salutation: run.output.salutation || "",
        } } : {}),
        ...(terminal && run.status !== "COMPLETED" ? { error: run.error?.message || "Cover generation failed." } : {}),
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const { id, model } = req.body || {};
    const requestId = validRequestId(req.body?.requestId);
    if (!id || !requestId) return res.status(400).json({ error: "Missing id or valid requestId" });

    const recovered = await getReceiptForRequest("cover", id, requestId);
    if (recovered) return res.status(202).json({ runId: recovered.runId, requestId, recovered: true });

    const job = await getJob(id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (!job.fitReportId) return res.status(409).json({ error: "Generate the fit analysis first; the letter is written from it." });
    const report = await getReport(job.fitReportId);
    if (!report) return res.status(409).json({ error: "The linked fit analysis is missing. Regenerate it first." });

    const chosenModel = resolveModel(model);
    const fingerprint = coverFingerprint(job, report, chosenModel);
    await mutateJob(id, () => ({ coverRun: {
      requestId, runId: "", fingerprint, status: "dispatching", startedAt: new Date().toISOString(), finishedAt: "",
    } }));

    try {
      const key = await idempotencyKeys.create(`cover:${id}:${requestId}`, { scope: "global" });
      const handle = await tasks.trigger(COVER_TASK_ID, {
        jobId: id, requestId, fingerprint, model: chosenModel, origin: publicOrigin(),
      }, { idempotencyKey: key, idempotencyKeyTTL: "30d", tags: [`job:${id}`, `request:${requestId}`] });
      await saveRunReceipt({ kind: "cover", requestId, runId: handle.id, jobId: id, fingerprint });
      await mutateJob(id, (current) => current.coverRun?.requestId === requestId
        ? { coverRun: { ...current.coverRun, runId: handle.id,
            status: ["completed", "superseded"].includes(current.coverRun.status) ? current.coverRun.status : "queued" } }
        : undefined);
      return res.status(202).json({ runId: handle.id, requestId, recovered: false });
    } catch (error) {
      await mutateJob(id, (current) => current.coverRun?.requestId === requestId
        ? { coverRun: { ...current.coverRun, status: "dispatch_failed", finishedAt: new Date().toISOString() } }
        : undefined);
      throw error;
    }
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Unexpected error", detail: err.detail });
  }
}
