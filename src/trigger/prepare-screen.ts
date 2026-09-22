import { withAnalysisSettings } from "../../lib/sanity/analysis-settings.js";
import { withVersionInstructions } from "../../lib/version-instructions.js";
import { AbortTaskRunError, idempotencyKeys, metadata, task } from "@trigger.dev/sdk";
import { screenBriefTask } from "./brief.js";
import { companyResearchTask } from "./research.js";
import { briefFingerprint, researchFingerprint } from "../../lib/generation-fingerprint.js";
import { getActiveResearch } from "../../lib/screen-artifacts.js";
import { getJob, getReport, mutateJob } from "../../lib/store.js";
import { researchIsReusable } from "../../lib/screen-work.js";
import { resolveModel } from "../../lib/models.js";
import { prepareBaseFingerprint } from "../../lib/generation-review.js";
import { SCREEN_TASK_POLICY } from "../../lib/task-policy.js";

export type PreparePayload = { jobId: string; requestId: string; fingerprint: string; versionInstructions?: string; model: string; researchAction: "refresh" };
const childId = (requestId: string, suffix: string) => `${requestId.slice(0, 90)}-${suffix}`;

export const prepareScreenTask = task({
  id: "prepare-screen", maxDuration: SCREEN_TASK_POLICY.maxDuration, retry: SCREEN_TASK_POLICY.retry,
  queue: { concurrencyLimit: SCREEN_TASK_POLICY.concurrencyLimit },
  run: async (payload: PreparePayload) => withAnalysisSettings(async () => {
    metadata.set("phase", "loading").set("jobId", payload.jobId).set("requestId", payload.requestId);
    let job = withVersionInstructions(await getJob(payload.jobId), payload.versionInstructions);
    if (!job || job.prepareRun?.requestId !== payload.requestId || job.prepareRun?.fingerprint !== payload.fingerprint) {
      return { outcome: "superseded", jobId: payload.jobId, requestId: payload.requestId };
    }
    const model = resolveModel(payload.model);
    let report = job.fitReportId ? await getReport(job.fitReportId) : null;
    let research = await getActiveResearch(job);
    if (!report || payload.researchAction !== "refresh" ||
        prepareBaseFingerprint(job, report, model, payload.researchAction, research) !== payload.fingerprint) {
      await mutateJob(payload.jobId, (current) => current.prepareRun?.requestId === payload.requestId
        ? { prepareRun: { ...current.prepareRun, status: "superseded", finishedAt: new Date().toISOString() } } : undefined);
      return { outcome: "superseded", jobId: payload.jobId, requestId: payload.requestId };
    }
    if (!researchIsReusable(job, research, Date.now(), model) || payload.researchAction === "refresh") {
      metadata.set("phase", "researching");
      const requestId = childId(payload.requestId, "research");
      const fingerprint = researchFingerprint(job);
      await mutateJob(payload.jobId, (current) => current.prepareRun?.requestId === payload.requestId
        ? { researchRun: { requestId, runId: "", fingerprint, status: "queued", startedAt: new Date().toISOString(), finishedAt: "" } } : undefined);
      const key = await idempotencyKeys.create(`research:${payload.jobId}:${requestId}`, { scope: "global" });
      const result = await companyResearchTask.triggerAndWait({ jobId: payload.jobId, requestId, fingerprint, model, versionInstructions: payload.versionInstructions },
        { idempotencyKey: key, idempotencyKeyTTL: "30d", tags: [`job:${payload.jobId}`, `request:${requestId}`] });
      if (!result.ok) throw result.error;
      if (result.output.outcome !== "completed") {
        await mutateJob(payload.jobId, (current) => current.prepareRun?.requestId === payload.requestId
          ? { prepareRun: { ...current.prepareRun, status: result.output.outcome, finishedAt: new Date().toISOString() } } : undefined);
        return { ...result.output, requestId: payload.requestId };
      }
      job = withVersionInstructions(await getJob(payload.jobId), payload.versionInstructions); research = await getActiveResearch(job);
    }
    if (!job || !research) throw new AbortTaskRunError("Company research is missing.");
    report = job.fitReportId ? await getReport(job.fitReportId) : null;
    if (!report) throw new AbortTaskRunError("The linked fit analysis is missing.");
    if (job.prepareRun?.requestId !== payload.requestId || job.prepareRun?.fingerprint !== payload.fingerprint) {
      return { outcome: "superseded", jobId: payload.jobId, requestId: payload.requestId };
    }
    if (prepareBaseFingerprint(job, report, model, payload.researchAction, research) !== payload.fingerprint) {
      await mutateJob(payload.jobId, (current) => current.prepareRun?.requestId === payload.requestId
        ? { prepareRun: { ...current.prepareRun, status: "superseded", finishedAt: new Date().toISOString() } } : undefined);
      return { outcome: "superseded", jobId: payload.jobId, requestId: payload.requestId };
    }
    metadata.set("phase", "writing");
    const requestId = childId(payload.requestId, "brief");
    const fingerprint = briefFingerprint(job, report, research);
    await mutateJob(payload.jobId, (current) => current.prepareRun?.requestId === payload.requestId
      ? { briefRun: { requestId, runId: "", fingerprint, status: "queued", startedAt: new Date().toISOString(), finishedAt: "" } } : undefined);
    const key = await idempotencyKeys.create(`brief:${payload.jobId}:${requestId}`, { scope: "global" });
    const result = await screenBriefTask.triggerAndWait({ jobId: payload.jobId, requestId, fingerprint, model, versionInstructions: payload.versionInstructions },
      { idempotencyKey: key, idempotencyKeyTTL: "30d", tags: [`job:${payload.jobId}`, `request:${requestId}`] });
    if (!result.ok) throw result.error;
    await mutateJob(payload.jobId, (current) => current.prepareRun?.requestId === payload.requestId
      ? { prepareRun: { ...current.prepareRun, status: result.output.outcome, finishedAt: new Date().toISOString() } } : undefined);
    metadata.set("phase", result.output.outcome);
    return { ...result.output, requestId: payload.requestId };
  }),
});
