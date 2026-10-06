import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function applicationCvJobFingerprint(job) {
  return digest({jobId:String(job?.id || ''), reportId:String(job?.fitReportId || ''),
    company:String(job?.company || ''), role:String(job?.role || ''),
    jobDescription:String(job?.jobDescription || ''), instructions:String(job?.instructions || '')});
}

// The request identity includes every fact that can change the CV, including
// the published source revision and the fit analysis seen by the writer.
export function applicationCvFingerprint(job, sourceSnapshot, reportSnapshot, model, versionInstructions = '') {
  const input = {
    policy: 'application-cv-3',
    jobId: String(job?.id || ''),
    company: String(job?.company || ''),
    role: String(job?.role || ''),
    jobDescription: String(job?.jobDescription || ''),
    instructions: String(job?.instructions || ''),
    versionInstructions: String(versionInstructions || ''),
    source: sourceSnapshot,
    report: reportSnapshot,
    model: String(model || ''),
  };
  return digest(input);
}
