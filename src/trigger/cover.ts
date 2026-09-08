import { AbortTaskRunError, metadata, task } from "@trigger.dev/sdk";
import { executeCoverWork } from "../../lib/cover-work.js";
import { hasKV } from "../../lib/kv.js";
import { COVER_TASK_POLICY } from "../../lib/task-policy.js";

export type CoverPayload = {
  jobId: string;
  requestId: string;
  fingerprint: string;
  model: string;
  origin: string;
};

export const coverLetterTask = task({
  id: "cover-letter",
  maxDuration: COVER_TASK_POLICY.maxDuration,
  retry: COVER_TASK_POLICY.retry,
  queue: { concurrencyLimit: COVER_TASK_POLICY.concurrencyLimit },
  run: async (payload: CoverPayload) => {
    if (!hasKV) throw new AbortTaskRunError("KV is required by persistent workers.");
    metadata.set("phase", "loading").set("jobId", payload.jobId).set("requestId", payload.requestId);
    try {
      metadata.set("phase", "writing");
      const result = await executeCoverWork(payload);
      metadata.set("phase", result.outcome);
      return result;
    } catch (error) {
      if (error && typeof error === "object" && ("abort" in error ||
        ("status" in error && Number(error.status) < 500) ||
        (error instanceof Error && error.message.includes("ANTHROPIC_API_KEY")))) {
        throw new AbortTaskRunError(error instanceof Error ? error.message : "Cover generation cannot continue.");
      }
      throw error;
    }
  },
});
