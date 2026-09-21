import { AbortTaskRunError, metadata, task } from "@trigger.dev/sdk";
import { executeIngestBatch } from "../../lib/ingest-work.js";
import { getTaskInput } from "../../lib/task-results.js";
import { BATCH_TASK_POLICY } from "../../lib/task-policy.js";
import { ingestMinimumScore } from "../../lib/ingest-screening.js";
import { withGenerationContext } from "../../lib/generation-context.js";
import { hasKV } from "../../lib/kv.js";

export type IngestPayload = { requestId: string };
export const ingestTask = task({
  id: "ingest-opportunities", maxDuration: BATCH_TASK_POLICY.maxDuration, retry: BATCH_TASK_POLICY.retry,
  queue: { concurrencyLimit: BATCH_TASK_POLICY.concurrencyLimit },
  run: async (payload: IngestPayload, { ctx }) => withGenerationContext({ runId: ctx.run.id, taskAttempt: ctx.attempt.number }, async () => {
    if (!hasKV) throw new AbortTaskRunError("KV is required by persistent workers.");
    const input = await getTaskInput("ingest", payload.requestId);
    if (!Array.isArray(input)) throw new AbortTaskRunError("Stored ingest input was not found.");
    metadata.set("phase", "ingesting").set("total", input.length).set("requestId", payload.requestId);
    const policy = await getTaskInput("ingest-policy", payload.requestId);
    const result = await executeIngestBatch(input, { requestId: payload.requestId, minimumScore: policy?.minimumScore ?? ingestMinimumScore() });
    metadata.set("phase", "completed").set("added", result.added).set("updated", result.updated)
      .set("filtered", result.filtered).set("needsReview", result.needsReview).set("failed", result.failed);
    return { outcome: "completed", ...result };
  }),
});
