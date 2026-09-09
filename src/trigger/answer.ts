import { AbortTaskRunError, metadata, task } from "@trigger.dev/sdk";
import { executeAnswerWork } from "../../lib/answer-work.js";
import { hasKV } from "../../lib/kv.js";
import { ANSWER_TASK_POLICY } from "../../lib/task-policy.js";

export type AnswerPayload = {
  jobId: string;
  questionId: string;
  requestId: string;
  fingerprint: string;
  model: string;
};

export const answerTask = task({
  id: "application-answer",
  maxDuration: ANSWER_TASK_POLICY.maxDuration,
  retry: ANSWER_TASK_POLICY.retry,
  queue: { concurrencyLimit: ANSWER_TASK_POLICY.concurrencyLimit },
  run: async (payload: AnswerPayload) => {
    if (!hasKV) throw new AbortTaskRunError("KV is required by persistent workers.");
    metadata.set("phase", "answering").set("jobId", payload.jobId)
      .set("questionId", payload.questionId).set("requestId", payload.requestId);
    try {
      const result = await executeAnswerWork(payload);
      metadata.set("phase", result.outcome);
      return result;
    } catch (error) {
      if (error && typeof error === "object" && ("abort" in error ||
          ("status" in error && Number(error.status) < 500) ||
          (error instanceof Error && error.message.includes("ANTHROPIC_API_KEY")))) {
        throw new AbortTaskRunError(error instanceof Error ? error.message : "Answer generation cannot continue.");
      }
      throw error;
    }
  },
});
