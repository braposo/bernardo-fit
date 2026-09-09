import { AbortTaskRunError, metadata, task } from "@trigger.dev/sdk";
import { executeIngestBatch } from "../../lib/ingest-work.js";
import { getTaskInput } from "../../lib/task-results.js";
import { BATCH_TASK_POLICY } from "../../lib/task-policy.js";

export type IngestPayload = { requestId: string };
export const ingestTask = task({
  id: "ingest-opportunities", maxDuration: BATCH_TASK_POLICY.maxDuration, retry: BATCH_TASK_POLICY.retry,
  queue: { concurrencyLimit: BATCH_TASK_POLICY.concurrencyLimit },
  run: async (payload: IngestPayload) => {
    const input = await getTaskInput("ingest", payload.requestId);
    if (!Array.isArray(input)) throw new AbortTaskRunError("Stored ingest input was not found.");
    metadata.set("phase", "ingesting").set("total", input.length).set("requestId", payload.requestId);
    const result = await executeIngestBatch(input);
    metadata.set("phase", "completed").set("added", result.added).set("updated", result.updated);
    return { outcome: "completed", ...result };
  },
});
