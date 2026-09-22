import { idempotencyKeys, metadata, task } from "@trigger.dev/sdk";
import { analysisTask, type AnalysisPayload } from "./analysis.js";
import { analysisChildRequestId, summariseAnalysisBatch } from "../../lib/analyse-all.js";
import { analysisFingerprint } from "../../lib/generation-fingerprint.js";
import { resolveModel } from "../../lib/models.js";
import { getReport, listJobs, mutateJob } from "../../lib/store.js";
import { BATCH_TASK_POLICY } from "../../lib/task-policy.js";

export type AnalyseAllPayload = { requestId: string; model: string; jobs: Array<{
  id: string; fingerprint: string; model?: string; mode?: "create" | "replace"; reportId?: string;
}> };
export const analyseAllTask = task({
  id: "analyse-all", maxDuration: BATCH_TASK_POLICY.maxDuration, retry: BATCH_TASK_POLICY.retry,
  queue: { concurrencyLimit: BATCH_TASK_POLICY.concurrencyLimit },
  run: async (payload: AnalyseAllPayload) => {
    const model = resolveModel(payload.model);
    const reviewed = Array.isArray(payload.jobs) ? payload.jobs : [];
    const reviewedById = new Map(reviewed.map((item) => [item.id, item]));
    const pending: Array<{ job: any; model: string; mode: "create" | "replace"; reportId: string; fingerprint: string }> = [];
    for (const job of await listJobs({ includeArchived: true })) {
      const item = reviewedById.get(job.id);
      if (!item) continue;
      const selectedModel = resolveModel(item.model || model);
      const mode = item.mode === "replace" ? "replace" : "create";
      const reportId = mode === "replace" ? String(item.reportId || "") : "";
      const report = reportId ? await getReport(reportId) : null;
      if ((mode === "replace" && (!report || job.fitReportId !== reportId)) ||
          (mode === "create" && (job.fitReportId || String(job.jobDescription || "").trim().length < 20)) ||
          analysisFingerprint(job, selectedModel, mode, report) !== item.fingerprint) continue;
      pending.push({ job, model: selectedModel, mode, reportId, fingerprint: item.fingerprint });
    }
    const skipped = reviewed.length - pending.length;
    metadata.set("phase", pending.length ? "analysing" : "completed").set("total", reviewed.length).set("skipped", skipped);
    if (!pending.length) return { ...summariseAnalysisBatch([], []), reviewed: reviewed.length, skipped };
    const items: Array<{ payload: AnalysisPayload; options: any }> = [];
    for (const { job, model, mode, reportId, fingerprint } of pending) {
      const requestId = analysisChildRequestId(payload.requestId, job.id);
      await mutateJob(job.id, () => ({ analysisRun: { requestId, runId: "", fingerprint,
        status: "queued", startedAt: new Date().toISOString(), finishedAt: "" } }));
      const key = await idempotencyKeys.create(`analysis:${job.id}:${requestId}`, { scope: "global" });
      items.push({ payload: { jobId: job.id, requestId, fingerprint, model, mode, reportId },
        options: { idempotencyKey: key, idempotencyKeyTTL: "30d", tags: [`job:${job.id}`, `request:${requestId}`] } });
    }
    const result = await analysisTask.batchTriggerAndWait(items);
    const summary = summariseAnalysisBatch(pending.map(({ job }) => job), result.runs);
    metadata.set("phase", "completed").set("completed", summary.analysed).set("failed", summary.failed);
    return { ...summary, reviewed: reviewed.length, skipped };
  },
});
