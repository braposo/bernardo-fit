import { runCoverLetter } from "./cover.js";
import { getCoverArtifact, migrateLegacyCoverArtifacts, saveCoverArtifact } from "./cover-artifacts.js";
import { coverFingerprint } from "./generation-fingerprint.js";
import { getJob, getReport, getReportRevision, mutateJob } from "./store.js";
import { resolveModel } from "./models.js";

const finishedAt = () => new Date().toISOString();

async function attachArtifact({ jobId, requestId, fingerprint, model, artifact, versionCount }) {
  const latest = await getJob(jobId);
  if (!latest) return false;
  const report = latest.fitReportId ? await getReport(latest.fitReportId) : null;
  const reportRevision = latest.fitReportId ? await getReportRevision(latest.fitReportId) : 0;
  const selected = !!report && latest.coverRun?.requestId === requestId &&
    coverFingerprint(latest, report, model) === fingerprint;
  let attached = false;
  const patch = (current, canAttach) => {
    attached = canAttach && selected && current.coverRun?.requestId === requestId &&
      current.coverRun?.fingerprint === fingerprint && coverFingerprint(current, report, model) === fingerprint;
    if (!attached) {
      return current.coverRun?.requestId === requestId
        ? { coverRun: { ...current.coverRun, status: "superseded", finishedAt: finishedAt() } }
        : undefined;
    }
    return {
      coverLetterId: artifact.vid,
      coverLetterAt: artifact.at,
      coverLetterModel: artifact.model,
      coverLetterSalutation: artifact.salutation,
      coverLetterWords: artifact.words,
      coverLetterVersionCount: versionCount,
      coverLetter: null,
      coverLetterVersions: [],
      coverRun: { ...current.coverRun, status: "completed", finishedAt: finishedAt() },
    };
  };
  try {
    await mutateJob(jobId, (current) => patch(current, true), {
      expectedReportRevision: { id: latest.fitReportId, revision: reportRevision },
    });
  } catch (error) {
    if (!error || error.code !== "REPORT_CHANGED") throw error;
    attached = false;
    await mutateJob(jobId, (current) => patch(current, false));
  }
  return attached;
}

export async function executeCoverWork({ jobId, requestId, fingerprint, model, origin }) {
  const job = await getJob(jobId);
  if (!job) throw Object.assign(new Error("Job not found"), { status: 404, abort: true });
  const wantedModel = resolveModel(model);
  const report = job.fitReportId ? await getReport(job.fitReportId) : null;
  if (!report) throw Object.assign(new Error("The linked fit analysis is missing."), { status: 409, abort: true });

  if (job.coverRun?.requestId !== requestId || coverFingerprint(job, report, wantedModel) !== fingerprint) {
    if (job.coverRun?.requestId === requestId) {
      await mutateJob(jobId, (current) => current.coverRun?.requestId === requestId
        ? { coverRun: { ...current.coverRun, status: "superseded", finishedAt: finishedAt() } }
        : undefined);
    }
    return { outcome: "superseded", jobId, requestId };
  }

  const migration = await migrateLegacyCoverArtifacts(job);
  let persisted = await getCoverArtifact(jobId, requestId);
  let versionCount = Number(job.coverLetterVersionCount) || 0;

  if (!persisted) {
    const safeOrigin = /^https?:\/\//.test(origin || "") ? origin.replace(/\/$/, "") : "https://fit.bernardoraposo.com";
    const letter = await runCoverLetter({
      report,
      fitUrl: `${safeOrigin}/?r=${encodeURIComponent(job.fitReportId)}`,
      instructions: String(job.instructions || "").trim(),
      model: wantedModel,
      ref: requestId,
    });
    const saved = await saveCoverArtifact(jobId, {
      vid: requestId,
      at: letter.generatedAt,
      model: wantedModel,
      words: letter.words,
      salutation: letter.salutation,
      paragraphs: letter.paragraphs,
    }, { preserveId: job.coverLetterId || migration.activeId });
    persisted = saved.artifact;
    versionCount = saved.versionCount;
  } else {
    const saved = await saveCoverArtifact(jobId, persisted, { preserveId: job.coverLetterId || migration.activeId });
    versionCount = saved.versionCount;
  }

  const attached = await attachArtifact({
    jobId, requestId, fingerprint, model: wantedModel, artifact: persisted, versionCount,
  });
  return {
    outcome: attached ? "completed" : "superseded",
    jobId,
    requestId,
    words: persisted.words,
    salutation: persisted.salutation,
  };
}
