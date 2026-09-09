import { idempotencyKeys, metadata, task } from "@trigger.dev/sdk";
import { analysisTask, type AnalysisPayload } from "./analysis.js";
import { analysisChildRequestId, summariseAnalysisBatch } from "../../lib/analyse-all.js";
import { analysisFingerprint } from "../../lib/generation-fingerprint.js";
import { resolveModel } from "../../lib/models.js";
import { listJobs, mutateJob } from "../../lib/store.js";
import { BATCH_TASK_POLICY } from "../../lib/task-policy.js";

export type AnalyseAllPayload = { requestId: string; model: string };
export const analyseAllTask = task({
  id: "analyse-all", maxDuration: BATCH_TASK_POLICY.maxDuration, retry: BATCH_TASK_POLICY.retry,
  queue: { concurrencyLimit: BATCH_TASK_POLICY.concurrencyLimit },
  run: async (payload: AnalyseAllPayload) => {
    const model = resolveModel(payload.model);
    const pending = (await listJobs()).filter((job) => !job.fitReportId && String(job.jobDescription || "").trim().length >= 20);
    metadata.set("phase", pending.length ? "analysing" : "completed").set("total", pending.length);
    if (!pending.length) return summariseAnalysisBatch([], []);
    const items: Array<{ payload: AnalysisPayload; options: any }> = [];
    for (const job of pending) {
      const requestId = analysisChildRequestId(payload.requestId, job.id);
      const fingerprint = analysisFingerprint(job, model);
      await mutateJob(job.id, () => ({ analysisRun: { requestId, runId: "", fingerprint,
        status: "queued", startedAt: new Date().toISOString(), finishedAt: "" } }));
      const key = await idempotencyKeys.create(`analysis:${job.id}:${requestId}`, { scope: "global" });
      items.push({ payload: { jobId: job.id, requestId, fingerprint, model, mode: "create" },
        options: { idempotencyKey: key, idempotencyKeyTTL: "30d", tags: [`job:${job.id}`, `request:${requestId}`] } });
    }
    const result = await analysisTask.batchTriggerAndWait(items);
    const summary = summariseAnalysisBatch(pending, result.runs);
    metadata.set("phase", "completed").set("completed", summary.analysed).set("failed", summary.failed);
    return summary;
  },
});
