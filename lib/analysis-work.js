import { withVersionInstructions } from "./version-instructions.js";
import { runAnalysis, analysisContext } from "./analyze.js";
import { analysisFingerprint } from "./generation-fingerprint.js";
import { LEGACY_MODEL, resolveModel } from "./models.js";
import { applyAnalysisToOwners } from "./analysis-completion.js";
import {
  addReportVersion, findReportByHash, getJob, getReport, getReportRevision,
  listReportVersions, mutateJob, saveReportWithId,
} from "./store.js";

const finished = () => new Date().toISOString();

async function supersede(jobId, requestId) {
  if (!jobId) return;
  await mutateJob(jobId, (current) => current.analysisRun?.requestId === requestId
    ? { analysisRun: { ...current.analysisRun, status: "superseded", finishedAt: finished() } } : undefined);
}

export async function executeAnalysisWork({ jobId, reportId = "", requestId, fingerprint, model, mode = "create", versionInstructions = "" }) {
  const wanted = resolveModel(model);
  const job = withVersionInstructions(jobId ? await getJob(jobId) : null, versionInstructions);
  let existing = reportId ? await getReport(reportId) : job?.fitReportId ? await getReport(job.fitReportId) : null;
  const targetReportId = reportId || job?.fitReportId || "";
  if (mode === "create" && !job) throw Object.assign(new Error("Job not found"), { status: 404, abort: true });
  if (mode === "replace" && !existing) throw Object.assign(new Error("Report not found"), { status: 404, abort: true });
  if (job && (job.analysisRun?.requestId !== requestId || analysisFingerprint(job, wanted, mode, existing) !== fingerprint)) {
    await supersede(jobId, requestId);
    return { outcome: "superseded", jobId, requestId };
  }

  if (mode === "create") {
    const jd = String(job.jobDescription || "").trim();
    if (jd.length < 20) throw Object.assign(new Error("Add a fuller job description first."), { status: 409, abort: true });
    const cached = await findReportByHash(jd, { model: wanted, generation: analysisContext(job.instructions) });
    const wroteBy = cached?.report?.model || LEGACY_MODEL;
    if (!versionInstructions && cached && wroteBy === wanted) {
      await applyAnalysisToOwners(cached.id, null, { attachJobId: jobId, requestId });
      return { outcome: "completed", jobId, requestId, reportId: cached.id, cached: true };
    }
    const recovered = await getReport(requestId);
    if (recovered) {
      await applyAnalysisToOwners(requestId, null, { attachJobId: jobId, requestId });
      return { outcome: "completed", jobId, requestId, reportId: requestId, cached: false };
    }
    const generated = await runAnalysis(jd, { instructions: job.instructions, model: wanted, ref: requestId });
    const latest = withVersionInstructions(await getJob(jobId), versionInstructions);
    if (!latest || latest.analysisRun?.requestId !== requestId ||
        analysisFingerprint(latest, wanted, mode, null) !== fingerprint) {
      await supersede(jobId, requestId);
      return { outcome: "superseded", jobId, requestId };
    }
    generated.report.job_description = jd;
    generated.report.created_at = new Date().toISOString();
    generated.report.model = wanted;
    await saveReportWithId(requestId, generated.report, generated.internal, { versionInstructions });
    await applyAnalysisToOwners(requestId, generated.internal, { attachJobId: jobId, requestId });
    return { outcome: "completed", jobId, requestId, reportId: requestId, cached: false, scored: !!generated.internal };
  }

  const version = (await listReportVersions(targetReportId)).find((v) => v.vid === requestId);
  if (version) {
    await applyAnalysisToOwners(targetReportId, null, { attachJobId: jobId, requestId });
    return { outcome: "completed", jobId, requestId, reportId: targetReportId, versionId: requestId };
  }
  const revision = await getReportRevision(targetReportId);
  const jd = String(job?.jobDescription || existing.job_description || "").trim();
  const generated = await runAnalysis(jd, { instructions: job?.instructions || "", model: wanted, ref: requestId });
  const latestJob = withVersionInstructions(jobId ? await getJob(jobId) : null, versionInstructions);
  const latestReport = await getReport(targetReportId);
  if ((jobId && (!latestJob || latestJob.analysisRun?.requestId !== requestId ||
      analysisFingerprint(latestJob, wanted, mode, latestReport) !== fingerprint)) ||
      (!jobId && analysisFingerprint(null, wanted, mode, latestReport) !== fingerprint)) {
    await supersede(jobId, requestId);
    return { outcome: "superseded", jobId, requestId };
  }
  generated.report.job_description = jd;
  generated.report.created_at = existing.created_at;
  generated.report.regenerated_at = new Date().toISOString();
  generated.report.model = wanted;
  try {
    await addReportVersion(targetReportId, generated.report, generated.internal, { vid: requestId, expectedRevision: revision, versionInstructions });
  } catch (error) {
    if (error?.code === "REPORT_CHANGED") {
      await supersede(jobId, requestId);
      return { outcome: "superseded", jobId, requestId };
    }
    throw error;
  }
  await applyAnalysisToOwners(targetReportId, generated.internal, { attachJobId: jobId, requestId });
  return { outcome: "completed", jobId, requestId, reportId: targetReportId, versionId: requestId, scored: !!generated.internal };
}
