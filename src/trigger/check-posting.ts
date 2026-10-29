import { AbortTaskRunError, idempotencyKeys, metadata, task, tasks } from "@trigger.dev/sdk";
import { withGenerationContext } from "../../lib/generation-context.js";
import { executePostingCheck } from "../../lib/posting-check.js";
import { hasKV } from "../../lib/kv.js";
import { ATS_FORM_REQUEST_TASK_ID, CHECK_POSTING_TASK_ID } from "../../lib/task-policy.js";
import type { atsFormRequest } from "./ats-form-request";

// Posting gaps and application form drafts for a job at Reviewing. Nothing is
// submitted: results wait on the job as `postingCheck`. Triggered once per job,
// posting fingerprint, fit page presence, pasted questions and policy (the key
// is set by requestPostingCheck). Jev, the note and each answer draft run as
// durable model calls and the form read as an ats-form-request child, each
// owning its provider retries; this task retries only its own reads and the
// final write, reusing the checkpointed children.
export const checkPostingTask = task({
  id: CHECK_POSTING_TASK_ID, maxDuration: 300,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 15000, randomize: true },
  queue: { concurrencyLimit: 2 },
  run: async (payload: { jobId: string; force?: boolean }, { ctx }) =>
    withGenerationContext({ jobId: payload.jobId, runId: ctx.run.id, taskAttempt: ctx.attempt.number }, async () => {
      if (!hasKV) throw new AbortTaskRunError("KV is required by persistent workers.");
      if (typeof payload?.jobId !== "string" || !payload.jobId) throw new AbortTaskRunError("Missing job id.");
      metadata.set("phase", "checking");
      // Run-scoped key: a retry of this run reuses the read; a new run reads again.
      const fetchForm = async (target: any, policy: any) => {
        const result = await tasks.triggerAndWait<typeof atsFormRequest>(ATS_FORM_REQUEST_TASK_ID, { target, policy },
          { idempotencyKey: await idempotencyKeys.create([ATS_FORM_REQUEST_TASK_ID, target.provider, target.board, target.id]), maxDuration: 120 });
        if (!result.ok) throw new Error(`${target.provider} form request did not complete.`);
        return result.output;
      };
      try {
        const result = await executePostingCheck({ jobId: payload.jobId, force: payload.force === true }, { fetchForm });
        metadata.set("phase", result.outcome);
        return result;
      } catch (error) {
        if (error && typeof error === "object" && "abort" in error) throw new AbortTaskRunError(error instanceof Error ? error.message : "The posting check cannot continue.");
        throw error;
      }
    }),
});
