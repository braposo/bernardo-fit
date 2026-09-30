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
  state = {}, saveState = async () => {}, maxDescriptions = 20,
} = {}) {
  const window = linkedinWindow(state.lastSearch || lastSuccess, now);
  const found = await search({ window });
  const processed = Object.fromEntries(Object.entries(state.processed || {})
    .filter(([, date]) => Date.parse(date) > now.getTime() - 30 * 86400000));
  const pending = new Map((state.pending || []).map(job => [job.id, job]));
  for (const job of found.jobs) if (!processed[job.id] && !pending.has(job.id)) pending.set(job.id, job);
  const lastSearch = found.complete ? window.before : state.lastSearch;
  const persist = () => saveState({ lastSearch, processed, pending: [...pending.values()] });
  // Persist discoveries before advancing the search checkpoint, independently of ingestion.
  await persist();
  const report = { window, scans: found.scans, coverage: found.coverage, complete: found.complete,
    discovered: found.jobs.length, existing: [], added: [], screening: [], failures: [] };
  const jobs = await list({ includeArchived: true });
  if (found.blocked) return { ...report, complete: false, status: 'incomplete', deferred: pending.size };
  let batch = [];
  let batchId;
  async function flush() {
    if (!batch.length) return;
    const result = await ingest(batch, { requestId: 'linkedin-discovery-v1', minimumScore: 50, skipExisting: true });
    report.screening.push(...result.screeningRows);
    let verified = !result.failed && !result.needsReview && !result.updated;
    if (!verified) report.complete = false;
    for (const added of result.addedRows) {
      const job = await read(added.id);
      if (!job || admissionDecision(job.jevAssessment || {}, 50) !== 'accepted' ||
          !job.overviewSummary?.position?.trim() || !job.overviewSummary?.fit?.trim()) {
        report.complete = false;
        verified = false;
        report.failures.push({ id: added.id, reason: 'Saved assessment or Overview summary could not be verified' });
      } else { report.added.push(added); jobs.push(job); }
    }
    if (verified) {
      pending.delete(batchId);
      processed[batchId] = window.before;
    }
    await persist();
    batch = [];
  }
  let descriptions = 0;
  for (const posting of [...pending.values()]) {
    const identity = { ...posting, externalId: `linkedin-${posting.id}` };
    const existing = findExistingJobIn([...jobs, ...batch], identity);
    if (existing) {
      report.existing.push({ postingId: posting.id, id: existing.id, archived: !!existing.archived, stage: existing.stage });
      pending.delete(posting.id);
      processed[posting.id] = window.before;
      await persist();
      continue;
    }
    if (descriptions >= maxDescriptions) break;
    descriptions++;
    try {
      const opportunity = posting.opportunity || await describe(posting);
      pending.set(posting.id, { ...posting, opportunity });
      batch.push(opportunity);
      batchId = posting.id;
    }
    catch (error) {
      if (error.fatal) throw error;
      report.complete = false;
      report.failures.push({ postingId: posting.id, reason: error.message });
      if (error.stop) break;
    }
    await persist();
    await flush();
    await sleep(1200);
  }
  await flush();
  report.deferred = pending.size;
  report.status = !report.complete ? 'incomplete' : pending.size ? 'deferred' : 'completed';
  report.complete = report.status === 'completed';
  return report;
}
