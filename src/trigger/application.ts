import { AbortTaskRunError, idempotencyKeys, metadata, task } from "@trigger.dev/sdk";
import { withAnalysisSettings } from "../../lib/sanity/analysis-settings.js";
import { executeApplicationWork } from "../../lib/application-work.js";
import { mutateJob } from "../../lib/store.js";
import { APPLICATION_TASK_ID, APPLICATION_TASK_POLICY } from "../../lib/task-policy.js";
import { analysisTask } from "./analysis.js";
import { applicationCvTask } from "./application-cv.js";

export type ApplicationPayload = {
  jobId: string; requestId: string; fingerprint: string; model: string; mode: "create" | "replace";
  reportId?: string; analysisFingerprint: string; versionInstructions?: string; origin: string;
};

const childOptions = async (jobId: string, kind: string, requestId: string) => ({
  idempotencyKey: await idempotencyKeys.create(`${kind}:${jobId}:${requestId}`, { scope: "global" }),
  idempotencyKeyTTL: "30d", tags: [`job:${jobId}`, `request:${requestId}`],
});

// Coordinates the fit-analysis and CV children; each child owns its retries.
export const applicationTask = task({
  id: APPLICATION_TASK_ID, maxDuration: APPLICATION_TASK_POLICY.maxDuration, retry: APPLICATION_TASK_POLICY.retry,
  queue: { concurrencyLimit: APPLICATION_TASK_POLICY.concurrencyLimit },
  catchError: async ({ payload }: { payload: ApplicationPayload }) => {
    await mutateJob(payload.jobId, (current: any) => current.applicationRun?.requestId === payload.requestId &&
      ["dispatching", "queued"].includes(current.applicationRun.status)
      ? { applicationRun: { ...current.applicationRun, status: "failed", finishedAt: new Date().toISOString() } } : undefined);
  },
  run: async (payload: ApplicationPayload, { ctx }) => withAnalysisSettings(async () => {
    metadata.set("phase", "loading").set("jobId", payload.jobId).set("requestId", payload.requestId);
    try {
      const result = await executeApplicationWork(payload, {
        runId: ctx.run.id,
        onPhase: (phase: string) => { metadata.set("phase", phase); },
        runAnalysis: async (child: any) => {
          const result = await analysisTask.triggerAndWait(child, await childOptions(payload.jobId, "analyse", child.requestId));
          if (!result.ok) throw result.error;
          return result.output;
        },
        runCv: async (child: any) => {
          const result = await applicationCvTask.triggerAndWait(child, await childOptions(payload.jobId, "cv", child.requestId));
          if (!result.ok) throw result.error;
          return result.output;
        },
      });
      metadata.set("phase", result.outcome);
      return result;
    } catch (error) {
      if (error && typeof error === "object" && ("abort" in error || ("status" in error && Number(error.status) < 500)))
        throw new AbortTaskRunError(error instanceof Error ? error.message : "Application generation cannot continue.");
      throw error;
    }
  }),
});
