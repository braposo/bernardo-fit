import { AbortTaskRunError, metadata, task } from "@trigger.dev/sdk";
import { executePublicAnalysisWork } from "../../lib/public-analysis-work.js";
import { hasKV } from "../../lib/kv.js";
import { releasePublicAnalysisClaim } from "../../lib/public-analysis.js";
import { PUBLIC_ANALYSIS_TASK_POLICY } from "../../lib/task-policy.js";

export type PublicAnalysisPayload = { requestId: string; inputId: string; fingerprint: string };

export const publicAnalysisTask = task({
  id: "public-fit-analysis",
  maxDuration: PUBLIC_ANALYSIS_TASK_POLICY.maxDuration,
  retry: PUBLIC_ANALYSIS_TASK_POLICY.retry,
  queue: { concurrencyLimit: PUBLIC_ANALYSIS_TASK_POLICY.concurrencyLimit },
  run: async (payload: PublicAnalysisPayload) => {
    if (!hasKV) throw new AbortTaskRunError("KV is required by persistent workers.");
    metadata.set("phase", "analysing").set("requestId", payload.requestId);
    try {
      const result = await executePublicAnalysisWork(payload);
      metadata.set("phase", "saving");
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
  onFailure: async (payload) => {
    await releasePublicAnalysisClaim(payload.fingerprint, payload.requestId);
  },
});
