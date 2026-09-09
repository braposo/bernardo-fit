import { AbortTaskRunError, idempotencyKeys, metadata, task } from "@trigger.dev/sdk";
import { screenBriefTask } from "./brief.js";
import { companyResearchTask } from "./research.js";
import { briefFingerprint, researchFingerprint } from "../../lib/generation-fingerprint.js";
import { getActiveResearch } from "../../lib/screen-artifacts.js";
import { getJob, getReport, mutateJob } from "../../lib/store.js";
import { researchIsReusable } from "../../lib/screen-work.js";
import { PUBLIC_MODEL, resolveModel } from "../../lib/models.js";
import { SCREEN_TASK_POLICY } from "../../lib/task-policy.js";

export type PreparePayload = { jobId: string; requestId: string; fingerprint: string; model: string; forceResearch?: boolean };
const childId = (requestId: string, suffix: string) => `${requestId.slice(0, 90)}-${suffix}`;

export const prepareScreenTask = task({
  id: "prepare-screen", maxDuration: SCREEN_TASK_POLICY.maxDuration, retry: SCREEN_TASK_POLICY.retry,
  queue: { concurrencyLimit: SCREEN_TASK_POLICY.concurrencyLimit },
  run: async (payload: PreparePayload) => {
    metadata.set("phase", "loading").set("jobId", payload.jobId).set("requestId", payload.requestId);
    let job = await getJob(payload.jobId);
    if (!job || job.prepareRun?.requestId !== payload.requestId || job.prepareRun?.fingerprint !== payload.fingerprint) {
      return { outcome: "superseded", jobId: payload.jobId, requestId: payload.requestId };
    }
    let research = await getActiveResearch(job);
    if (payload.forceResearch || !researchIsReusable(job, research)) {
      metadata.set("phase", "researching");
      const requestId = childId(payload.requestId, "research");
      const fingerprint = researchFingerprint(job);
      await mutateJob(payload.jobId, (current) => current.prepareRun?.requestId === payload.requestId
        ? { researchRun: { requestId, runId: "", fingerprint, status: "queued", startedAt: new Date().toISOString(), finishedAt: "" } } : undefined);
      const key = await idempotencyKeys.create(`research:${payload.jobId}:${requestId}`, { scope: "global" });
      const result = await companyResearchTask.triggerAndWait({ jobId: payload.jobId, requestId, fingerprint, model: PUBLIC_MODEL },
        { idempotencyKey: key, idempotencyKeyTTL: "30d", tags: [`job:${payload.jobId}`, `request:${requestId}`] });
      if (!result.ok) throw result.error;
      if (result.output.outcome !== "completed") {
        await mutateJob(payload.jobId, (current) => current.prepareRun?.requestId === payload.requestId
          ? { prepareRun: { ...current.prepareRun, status: result.output.outcome, finishedAt: new Date().toISOString() } } : undefined);
        return { ...result.output, requestId: payload.requestId };
      }
      job = await getJob(payload.jobId); research = await getActiveResearch(job);
    }
    if (!job || !research) throw new AbortTaskRunError("Company research is missing.");
    const report = job.fitReportId ? await getReport(job.fitReportId) : null;
    if (!report) throw new AbortTaskRunError("The linked fit analysis is missing.");
    if (job.prepareRun?.requestId !== payload.requestId || job.prepareRun?.fingerprint !== payload.fingerprint) {
      return { outcome: "superseded", jobId: payload.jobId, requestId: payload.requestId };
    }
    metadata.set("phase", "writing");
    const requestId = childId(payload.requestId, "brief");
    const fingerprint = briefFingerprint(job, report, research);
    const model = resolveModel(payload.model);
    await mutateJob(payload.jobId, (current) => current.prepareRun?.requestId === payload.requestId
      ? { briefRun: { requestId, runId: "", fingerprint, status: "queued", startedAt: new Date().toISOString(), finishedAt: "" } } : undefined);
    const key = await idempotencyKeys.create(`brief:${payload.jobId}:${requestId}`, { scope: "global" });
    const result = await screenBriefTask.triggerAndWait({ jobId: payload.jobId, requestId, fingerprint, model },
      { idempotencyKey: key, idempotencyKeyTTL: "30d", tags: [`job:${payload.jobId}`, `request:${requestId}`] });
    if (!result.ok) throw result.error;
    await mutateJob(payload.jobId, (current) => current.prepareRun?.requestId === payload.requestId
      ? { prepareRun: { ...current.prepareRun, status: result.output.outcome, finishedAt: new Date().toISOString() } } : undefined);
    metadata.set("phase", result.output.outcome);
    return { ...result.output, requestId: payload.requestId };
  },
});
