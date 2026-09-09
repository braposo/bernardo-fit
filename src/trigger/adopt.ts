import { metadata, task } from "@trigger.dev/sdk";
import { executeAdoptReports } from "../../lib/adopt-work.js";
import { BATCH_TASK_POLICY } from "../../lib/task-policy.js";

export type AdoptPayload = { requestId: string };
export const adoptReportsTask = task({
  id: "adopt-reports", maxDuration: BATCH_TASK_POLICY.maxDuration, retry: BATCH_TASK_POLICY.retry,
  queue: { concurrencyLimit: BATCH_TASK_POLICY.concurrencyLimit },
  run: async (payload: AdoptPayload) => {
    metadata.set("phase", "adopting").set("requestId", payload.requestId);
    const result = await executeAdoptReports();
    metadata.set("phase", "completed").set("added", result.added);
    return result;
  },
});
