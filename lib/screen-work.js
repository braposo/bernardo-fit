import { runResearch } from "./research.js";
import { runBrief } from "./brief.js";
import { briefFingerprint, researchFingerprint } from "./generation-fingerprint.js";
import { getActiveResearch, getScreenArtifact, saveScreenArtifact } from "./screen-artifacts.js";
import { getJob, getReport, getReportRevision, mutateJob } from "./store.js";
import { PUBLIC_MODEL, resolveModel } from "./models.js";

const done = () => new Date().toISOString();
export const RESEARCH_REUSE_MS = 7 * 24 * 60 * 60 * 1000;

export function researchIsReusable(job, research, now = Date.now()) {
  return !!research && job.researchFingerprint === researchFingerprint(job) &&
    now - (Date.parse(research.at) || 0) <= RESEARCH_REUSE_MS;
}

async function finishRun(jobId, field, requestId, patch) {
  return mutateJob(jobId, (current) => current[field]?.requestId === requestId
    ? { ...patch, [field]: { ...current[field], status: patch[field]?.status || "completed", finishedAt: done() } }
    : undefined);
}

export async function executeResearchWork({ jobId, requestId, fingerprint, model = PUBLIC_MODEL }) {
  const job = await getJob(jobId);
  if (!job) throw Object.assign(new Error("Job not found"), { status: 404, abort: true });
  if (job.researchRun?.requestId !== requestId || researchFingerprint(job) !== fingerprint) {
    await finishRun(jobId, "researchRun", requestId, { researchRun: { status: "superseded" } });
    return { outcome: "superseded", jobId, requestId };
  }
  let artifact = await getScreenArtifact("research", jobId, requestId);
  if (!artifact) artifact = await saveScreenArtifact("research", jobId, requestId,
    await runResearch({ job, model, ref: requestId }));
  let attached = false;
  await mutateJob(jobId, (current) => {
    attached = current.researchRun?.requestId === requestId && current.researchRun?.fingerprint === fingerprint &&
      researchFingerprint(current) === fingerprint;
    return attached ? {
      researchId: requestId, researchAt: artifact.at, researchModel: artifact.model,
      researchSourceCount: artifact.sources.length, researchPartial: artifact.partial,
      researchFingerprint: fingerprint,
      ...(current.researchId && current.researchId !== requestId ? { briefFingerprint: "" } : {}),
      researchRun: { ...current.researchRun, status: "completed", finishedAt: done() },
    } : current.researchRun?.requestId === requestId
      ? { researchRun: { ...current.researchRun, status: "superseded", finishedAt: done() } } : undefined;
  });
  return { outcome: attached ? "completed" : "superseded", jobId, requestId, artifactId: requestId,
    sources: artifact.sources.length, partial: artifact.partial };
}

export async function executeBriefWork({ jobId, requestId, fingerprint, model }) {
  const job = await getJob(jobId);
  if (!job) throw Object.assign(new Error("Job not found"), { status: 404, abort: true });
  const report = job.fitReportId ? await getReport(job.fitReportId) : null;
  const research = await getActiveResearch(job);
  const wantedModel = resolveModel(model);
  if (!report || !research) throw Object.assign(new Error("Research and fit analysis are required before writing a brief."), { status: 409, abort: true });
  if (job.briefRun?.requestId !== requestId || briefFingerprint(job, report, research) !== fingerprint) {
    await finishRun(jobId, "briefRun", requestId, { briefRun: { status: "superseded" } });
    return { outcome: "superseded", jobId, requestId };
  }
  let artifact = await getScreenArtifact("brief", jobId, requestId);
  if (!artifact) artifact = await saveScreenArtifact("brief", jobId, requestId,
    await runBrief({ job, report, research, model: wantedModel, ref: requestId }));
  const reportRevision = await getReportRevision(job.fitReportId);
  let attached = false;
  const patch = (current, validReport) => {
    attached = validReport && current.briefRun?.requestId === requestId && current.briefRun?.fingerprint === fingerprint &&
      current.researchId === research.id && briefFingerprint(current, report, research) === fingerprint;
    return attached ? {
      briefId: requestId, briefAt: artifact.at, briefModel: artifact.model, briefStage: "screen", briefFingerprint: fingerprint,
      briefRun: { ...current.briefRun, status: "completed", finishedAt: done() },
    } : current.briefRun?.requestId === requestId
      ? { briefRun: { ...current.briefRun, status: "superseded", finishedAt: done() } } : undefined;
  };
  try { await mutateJob(jobId, (current) => patch(current, true), { expectedReportRevision: { id: job.fitReportId, revision: reportRevision } }); }
  catch (error) {
    if (error?.code !== "REPORT_CHANGED") throw error;
    await mutateJob(jobId, (current) => patch(current, false));
  }
  return { outcome: attached ? "completed" : "superseded", jobId, requestId, artifactId: requestId };
}
