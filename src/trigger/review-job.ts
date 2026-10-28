import { AbortTaskRunError, metadata, task } from "@trigger.dev/sdk";
import { withGenerationContext } from "../../lib/generation-context.js";
import { executeJobReview } from "../../lib/review-agent.js";
import { hasKV } from "../../lib/kv.js";
import { REVIEW_JOB_TASK_ID } from "../../lib/task-policy.js";

// Shadow-mode review of a job admitted at New: records Jev's suggestion on the
// job and never changes its stage. Triggered once per job and assessment (the
// idempotency key is set by requestJobReview). The Jev request runs as a durable
// model call whose provider child owns HTTP retries; this task retries only its
// own reads and the final write, reusing the checkpointed Jev answer.
export const reviewJobTask = task({
  id: REVIEW_JOB_TASK_ID, maxDuration: 180,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 15000, randomize: true },
  queue: { concurrencyLimit: 2 },
  run: async (payload: { jobId: string }, { ctx }) =>
    withGenerationContext({ jobId: payload.jobId, runId: ctx.run.id, taskAttempt: ctx.attempt.number }, async () => {
      if (!hasKV) throw new AbortTaskRunError("KV is required by persistent workers.");
      if (typeof payload?.jobId !== "string" || !payload.jobId) throw new AbortTaskRunError("Missing job id.");
      metadata.set("phase", "reviewing");
      try { const result = await executeJobReview(payload); metadata.set("phase", result.outcome); return result; }
      catch (error) {
        if (error && typeof error === "object" && "abort" in error) throw new AbortTaskRunError(error instanceof Error ? error.message : "The review cannot continue.");
        throw error;
      }
    }),
});
