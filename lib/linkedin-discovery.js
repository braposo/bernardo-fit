import { searchLinkedIn, linkedinOpportunity, linkedinWindow } from './linkedin-source.js';
import { listJobs, getJob, findExistingJobIn } from './store.js';
import { executeIngestBatch } from './ingest-work.js';
import { admissionDecision } from './ingest-screening.js';

// Assessment/summary fingerprints include the description, profile and rubric.
// A stable request ID reuses these 30-day caches across overlapping daily windows.
export async function discoverLinkedIn({ lastSuccess, now = new Date(),
  search = searchLinkedIn, describe = linkedinOpportunity, list = listJobs,
  ingest = executeIngestBatch, read = getJob,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const window = linkedinWindow(lastSuccess, now);
  const found = await search({ window });
  const report = { window, scans: found.scans, coverage: found.coverage, complete: found.complete,
    discovered: found.jobs.length, existing: [], added: [], screening: [], failures: [] };
  const jobs = await list({ includeArchived: true });
  if (found.blocked) return { ...report, complete: false };
  let batch = [];
  async function flush() {
    if (!batch.length) return;
    const result = await ingest(batch, { requestId: 'linkedin-discovery-v1', minimumScore: 50, skipExisting: true });
    report.screening.push(...result.screeningRows);
    if (result.failed || result.needsReview || result.updated) report.complete = false;
    for (const added of result.addedRows) {
      const job = await read(added.id);
      if (!job || admissionDecision(job.jevAssessment || {}, 50) !== 'accepted' ||
          !job.overviewSummary?.position?.trim() || !job.overviewSummary?.fit?.trim()) {
        report.complete = false;
        report.failures.push({ id: added.id, reason: 'Saved assessment or Overview summary could not be verified' });
      } else { report.added.push(added); jobs.push(job); }
    }
    batch = [];
  }
  for (const posting of found.jobs) {
    const identity = { ...posting, externalId: `linkedin-${posting.id}` };
    const existing = findExistingJobIn([...jobs, ...batch], identity);
    if (existing) {
      report.existing.push({ postingId: posting.id, id: existing.id, archived: !!existing.archived, stage: existing.stage });
      continue;
    }
    try { batch.push(await describe(posting)); }
    catch (error) {
      report.complete = false;
      report.failures.push({ postingId: posting.id, reason: error.message });
      if (error.stop) break;
    }
    if (batch.length >= 20) await flush();
    await sleep(1200);
  }
  await flush();
  return report;
}
