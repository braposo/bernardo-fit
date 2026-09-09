import { AbortTaskRunError, metadata, task } from "@trigger.dev/sdk";
import { executeResearchWork } from "../../lib/screen-work.js";
import { hasKV } from "../../lib/kv.js";
import { SCREEN_TASK_POLICY } from "../../lib/task-policy.js";

export type ResearchPayload = { jobId: string; requestId: string; fingerprint: string; model?: string };
export const companyResearchTask = task({
  id: "company-research", maxDuration: SCREEN_TASK_POLICY.maxDuration, retry: SCREEN_TASK_POLICY.retry,
  queue: { concurrencyLimit: SCREEN_TASK_POLICY.concurrencyLimit },
  run: async (payload: ResearchPayload) => {
    if (!hasKV) throw new AbortTaskRunError("KV is required by persistent workers.");
    metadata.set("phase", "researching").set("jobId", payload.jobId).set("requestId", payload.requestId);
    try { const out = await executeResearchWork(payload); metadata.set("phase", out.outcome); return out; }
    catch (error) { if (error && typeof error === "object" && ("abort" in error || ("status" in error && Number(error.status) < 500))) throw new AbortTaskRunError(error instanceof Error ? error.message : "Research cannot continue."); throw error; }
  },
});
