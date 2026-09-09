import { AbortTaskRunError, metadata, task } from "@trigger.dev/sdk";
import { executeAnalysisWork } from "../../lib/analysis-work.js";
import { hasKV } from "../../lib/kv.js";
import { ANALYSIS_TASK_POLICY } from "../../lib/task-policy.js";

export type AnalysisPayload = {
  jobId?: string;
  reportId?: string;
  requestId: string;
  fingerprint: string;
  model: string;
  mode?: "create" | "replace";
};

export const analysisTask = task({
  id: "fit-analysis",
  maxDuration: ANALYSIS_TASK_POLICY.maxDuration,
  retry: ANALYSIS_TASK_POLICY.retry,
  queue: { concurrencyLimit: ANALYSIS_TASK_POLICY.concurrencyLimit },
  run: async (payload: AnalysisPayload) => {
    if (!hasKV) throw new AbortTaskRunError("KV is required by persistent workers.");
    metadata.set("phase", "analysing").set("requestId", payload.requestId);
    if (payload.jobId) metadata.set("jobId", payload.jobId);
    try {
      const result = await executeAnalysisWork(payload);
      metadata.set("phase", result.outcome);
      return result;
    } catch (error) {
      if (error && typeof error === "object" && ("abort" in error ||
          ("status" in error && Number(error.status) < 500) ||
          (error instanceof Error && error.message.includes("ANTHROPIC_API_KEY")))) {
        throw new AbortTaskRunError(error instanceof Error ? error.message : "Analysis cannot continue.");
      }
      throw error;
    }
  },
});
