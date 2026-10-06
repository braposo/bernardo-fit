import { getApplicationCvSummaries } from './application-cv-store.js';
import { applicationCvJobFingerprint } from './application-cv-fingerprint.js';
import { loadApplicationCvSource } from './application-cv-source.js';

export function applicationCvFields(job, application, { sourceFingerprint, sourceUnavailable = false } = {}) {
  if (!application) return { hasCv: false, cvRun: null, applicationCv: null, applicationFitUrl: '' };
  const version = application.currentVersion;
  const latestVersion = application.latestVersion || null;
  const ready = !!application.currentVersionId && !!version;
  const fitUrl = ready ? `/fit/${encodeURIComponent(application.publicId)}` : '';
  const stale = !!version && (sourceUnavailable ||
    !!version.jobFingerprint && version.jobFingerprint !== applicationCvJobFingerprint(job) ||
    !!version.reportId && version.reportId !== job.fitReportId ||
    !!sourceFingerprint && version.sourceFingerprint !== sourceFingerprint);
  const validation = application.run?.validation || version?.validation;
  return {
    hasCv: ready, cvRun: application.run || null, applicationFitUrl: fitUrl,
    applicationCv: {
      publicId: application.publicId, fitUrl, downloadUrl: fitUrl ? `${fitUrl}/cv.pdf` : '',
      currentVersionId: application.currentVersionId || '', submittedVersionId: application.submittedVersionId || '',
      latestVersionId: latestVersion?.id || '', latestVersion,
      run: application.run || null, stale, sourceUnavailable, status: application.run?.status || (ready ? 'completed' : 'missing'),
      createdAt: version?.createdAt || '', validationStatus: validation?.status || '',
      validationSummary: validation ? { status: validation.status, issues: validation.issues || [] } : null,
    },
  };
}

export async function withApplicationCvFields(job) {
  const applications = await getApplicationCvSummaries([job.id]);
  let sourceState = {};
  if (applications[job.id]?.currentVersionId) {
    try { sourceState.sourceFingerprint = (await loadApplicationCvSource(job)).fingerprint; }
    catch { sourceState.sourceUnavailable = true; }
  }
  return { ...job, ...applicationCvFields(job, applications[job.id], sourceState) };
}
