import { idempotencyKeys, metadata, task } from "@trigger.dev/sdk";
import { jevScoreTask } from "./jev.js";
import { analysisChildRequestId } from "../../lib/analyse-all.js";
import { selectScoringCandidates, summariseScoringBatch } from "../../lib/score-listed.js";
import { listJobs, mutateJob } from "../../lib/store.js";
import { BATCH_TASK_POLICY, SCORE_LISTED_TASK_ID } from "../../lib/task-policy.js";

export type ScoreListedPayload = { requestId: string; jobs: Array<{ id: string; fingerprint: string }> };
export const scoreListedTask = task({
  id: SCORE_LISTED_TASK_ID, maxDuration: 3600, retry: BATCH_TASK_POLICY.retry,
  queue: { concurrencyLimit: BATCH_TASK_POLICY.concurrencyLimit },
  run: async (payload: ScoreListedPayload) => {
    const reviewed = Array.isArray(payload.jobs) ? payload.jobs : [];
    const reviewedById = new Map(reviewed.map((item) => [item.id, item.fingerprint]));
    const pending = selectScoringCandidates(await listJobs(), reviewed);
    const skipped = reviewed.length - pending.length;
    metadata.set("phase", pending.length ? "scoring" : "completed").set("total", reviewed.length).set("skipped", skipped);
    if (!pending.length) return { ...summariseScoringBatch([], []), reviewed: reviewed.length, skipped };
    const items: Array<{ payload: { jobId: string; requestId: string; fingerprint: string }; options: any }> = [];
    for (const job of pending) {
      const requestId = analysisChildRequestId(payload.requestId, job.id);
      const fingerprint = reviewedById.get(job.id)!;
      await mutateJob(job.id, () => ({ jevRun: { requestId, runId: "", fingerprint,
        status: "queued", startedAt: new Date().toISOString(), finishedAt: "" } }));
      const key = await idempotencyKeys.create(`jev-score:${job.id}:${requestId}`, { scope: "global" });
      items.push({ payload: { jobId: job.id, requestId, fingerprint },
        options: { idempotencyKey: key, idempotencyKeyTTL: "30d", tags: [`job:${job.id}`, `request:${requestId}`] } });
    }
    const result = await jevScoreTask.batchTriggerAndWait(items);
    const summary = summariseScoringBatch(pending, result.runs);
    metadata.set("phase", "completed").set("completed", summary.assessed).set("failed", summary.failed);
    return { ...summary, reviewed: reviewed.length, skipped };
  },
});
