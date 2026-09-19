import { AbortTaskRunError, metadata, task } from "@trigger.dev/sdk";
import { withGenerationContext } from "../../lib/generation-context.js";
import { executeJevWork } from "../../lib/jev-work.js";
import { hasKV } from "../../lib/kv.js";

export const jevScoreTask = task({
  id: "jev-score", maxDuration: 120,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 15000, randomize: true },
  queue: { concurrencyLimit: 2 },
  run: async (payload: { jobId: string; requestId: string; fingerprint: string }, { ctx }) =>
    withGenerationContext({ jobId: payload.jobId, runId: ctx.run.id, taskAttempt: ctx.attempt.number }, async () => {
      if (!hasKV) throw new AbortTaskRunError("KV is required by persistent workers.");
      metadata.set("phase", "scoring");
      try { const result = await executeJevWork(payload); metadata.set("phase", result.outcome); return result; }
      catch (error) {
        if (error && typeof error === "object" && "abort" in error) throw new AbortTaskRunError(error instanceof Error ? error.message : "Jev cannot continue.");
        throw error;
      }
    }),
});
