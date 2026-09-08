import { runCoverLetter } from "./cover.js";
import { coverFingerprint } from "./generation-fingerprint.js";
import { getJob, getReport, getReportRevision, mutateJob } from "./store.js";
import { resolveModel } from "./models.js";

export async function executeCoverWork({ jobId, requestId, fingerprint, model, origin }) {
  const job = await getJob(jobId);
  if (!job) throw Object.assign(new Error("Job not found"), { status: 404, abort: true });
  const wantedModel = resolveModel(model);
  const report = job.fitReportId ? await getReport(job.fitReportId) : null;
  if (!report) throw Object.assign(new Error("The linked fit analysis is missing."), { status: 409, abort: true });

  if (job.coverRun?.requestId !== requestId || coverFingerprint(job, report, wantedModel) !== fingerprint) {
    if (job.coverRun?.requestId === requestId) {
      await mutateJob(jobId, (current) => current.coverRun?.requestId === requestId
        ? { coverRun: { ...current.coverRun, status: "superseded", finishedAt: new Date().toISOString() } }
        : undefined);
    }
    return { outcome: "superseded", jobId, requestId };
  }

  // A retry after persistence returns the stored result without another model call.
  const persisted = (job.coverLetterVersions || []).find((v) => v.vid === requestId);
  if (persisted) {
    if (persisted.active && job.coverRun?.status !== "completed") {
      await mutateJob(jobId, (current) => current.coverRun?.requestId === requestId
        ? { coverRun: { ...current.coverRun, status: "completed", finishedAt: persisted.at } }
        : undefined);
    }
    return { outcome: persisted.active ? "completed" : "superseded", jobId, requestId,
      words: persisted.words || 0, salutation: persisted.salutation || "" };
  }

  const safeOrigin = /^https?:\/\//.test(origin || "") ? origin.replace(/\/$/, "") : "https://fit.bernardoraposo.com";
  const letter = await runCoverLetter({
    report,
    fitUrl: `${safeOrigin}/?r=${encodeURIComponent(job.fitReportId)}`,
    instructions: String(job.instructions || "").trim(),
    model: wantedModel,
    ref: requestId,
  });

  const latest = await getJob(jobId);
  if (!latest) return { outcome: "superseded", jobId, requestId };
  const latestReportRevision = latest?.fitReportId ? await getReportRevision(latest.fitReportId) : 0;
  const latestReport = latest?.fitReportId ? await getReport(latest.fitReportId) : null;
  const selected = !!latest && !!latestReport && latest.coverRun?.requestId === requestId &&
    coverFingerprint(latest, latestReport, wantedModel) === fingerprint;
  const version = {
    vid: requestId,
    at: letter.generatedAt,
    model: wantedModel,
    words: letter.words,
    salutation: letter.salutation,
    paragraphs: letter.paragraphs,
    active: false,
  };

  let attached = false;
  function resultPatch(current, canAttach) {
    attached = canAttach && selected && current.coverRun?.requestId === requestId &&
      current.coverRun?.fingerprint === fingerprint &&
      coverFingerprint(current, latestReport, wantedModel) === fingerprint;
    const savedVersion = { ...version, active: attached };
    const candidates = [savedVersion, ...(current.coverLetterVersions || [])
      .filter((v) => v.vid !== requestId)
      .map((v) => ({ ...v, active: attached ? false : v.active }))];
    const versions = candidates.slice(0, 10);
    if (!attached && !versions.some((v) => v.active)) {
      const active = candidates.find((v) => v.active);
      if (active) versions[versions.length - 1] = active;
    }
    return attached ? {
      coverLetter: letter.paragraphs,
      coverLetterAt: letter.generatedAt,
      coverLetterModel: wantedModel,
      coverLetterSalutation: letter.salutation,
      coverLetterWords: letter.words,
      coverLetterVersions: versions,
      coverRun: { ...current.coverRun, status: "completed", finishedAt: new Date().toISOString() },
    } : {
      coverLetterVersions: versions,
      ...(current.coverRun?.requestId === requestId
        ? { coverRun: { ...current.coverRun, status: "superseded", finishedAt: new Date().toISOString() } }
        : {}),
    };
  }
  try {
    await mutateJob(jobId, (current) => resultPatch(current, true), {
      expectedReportRevision: { id: latest.fitReportId, revision: latestReportRevision },
    });
  } catch (error) {
    if (!error || error.code !== "REPORT_CHANGED") throw error;
    attached = false;
    await mutateJob(jobId, (current) => resultPatch(current, false));
  }

  return { outcome: attached ? "completed" : "superseded", jobId, requestId,
    words: letter.words, salutation: letter.salutation };
}
