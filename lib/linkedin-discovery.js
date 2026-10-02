import { searchLinkedIn, linkedinOpportunity, linkedinWindow } from './linkedin-source.js';
import { listJobs, getJob, findExistingJobIn } from './store.js';
import { executeIngestBatch } from './ingest-work.js';
import { admissionDecision, ingestMinimumScore } from './ingest-screening.js';
import { screenLinkedInCard, screenLinkedInCards } from './linkedin-card-screening.js';

export async function discoverLinkedIn({ lastSuccess, now = new Date(),
  search = searchLinkedIn, describe = linkedinOpportunity, list = listJobs,
  ingest = executeIngestBatch, read = getJob,
  state = {}, saveState = async () => {}, prescreen = screenLinkedInCard, prescreenBatch, progress = async () => {},
} = {}) {
  const started = Date.now();
  const timings = {};
  let currentPhase, phaseStarted = started;
  const emit = async (phase, fields = {}) => {
    const time = Date.now();
    if (currentPhase) timings[currentPhase] = (timings[currentPhase] || 0) + time - phaseStarted;
    currentPhase = phase; phaseStarted = time;
    await progress({ phase, elapsedMs: time - started, timings: { ...timings }, ...fields });
  };
  const minimumScore = ingestMinimumScore();
  const window = linkedinWindow(state.lastSearch || lastSuccess, now);
  await emit('searching');
  const found = await search({ window });
  const processed = Object.fromEntries(Object.entries(state.processed || {})
    .filter(([, date]) => Date.parse(date) > now.getTime() - 30 * 86400000));
  const pending = new Map((state.pending || []).map(job => [String(job.id), job]));
  const currentIds = new Set(found.jobs.map(job => String(job.id)));
  for (const job of found.jobs) {
    const id = String(job.id);
    if (processed[id]) continue;
    const previous = pending.get(id);
    pending.set(id, { ...previous, ...job, ...(previous?.opportunity ? { opportunity: previous.opportunity } : {}) });
  }
  const lastSearch = found.complete ? window.before : state.lastSearch;
  const persist = () => saveState({ lastSearch, processed, pending: [...pending.values()] });
  await persist();
  const report = { window, scans: found.scans, coverage: found.coverage, searchCoverageComplete: found.complete,
    complete: found.complete, discovered: found.jobs.length, existing: [], added: [], screening: [],
    prescreening: [], failures: [], excluded: 0, deferred: 0, pendingBacklog: 0, qualified: 0,
    descriptionRequests: 0, descriptionsFetched: 0, cachedDescriptionsUsed: 0, timings };
  const jobs = await list({ includeArchived: true });
  if (found.blocked) {
    report.complete = false;
    report.deferred = [...pending.keys()].filter(id => currentIds.has(id)).length;
    report.pendingBacklog = pending.size - report.deferred;
    return { ...report, status: 'incomplete' };
  }

  // Only process records in today's bounded search result set. Older pending
  // rows remain durable and visible but do not expand the paid daily scope.
  const candidates = [];
  for (const id of currentIds) {
    const posting = pending.get(id);
    if (!posting) continue;
    const identity = { ...posting, externalId: `linkedin-${posting.id}` };
    const existing = findExistingJobIn(jobs, identity);
    if (existing) {
      report.existing.push({ postingId: posting.id, id: existing.id, archived: !!existing.archived, stage: existing.stage });
      pending.delete(String(posting.id));
      processed[String(posting.id)] = window.before;
      await persist();
      continue;
    }
    candidates.push(posting);
  }

  await emit('screening', { discovered: report.discovered, existing: report.existing.length, candidates: candidates.length });
  const screeningById = new Map();
  const batchScreen = prescreenBatch || (prescreen === screenLinkedInCard ? screenLinkedInCards : undefined);
  if (batchScreen && candidates.length) {
    try {
      const rows = await batchScreen(candidates);
      for (const row of rows || []) screeningById.set(String(row.postingId), row);
    } catch (error) {
      if (error.fatal) throw error;
      for (const posting of candidates) screeningById.set(String(posting.id), { decision: 'defer', reason: error.message });
      report.failures.push({ phase: 'prescreening', reason: error.message, count: candidates.length });
    }
  } else {
    for (const [index, posting] of candidates.entries()) {
      try {
        const result = await prescreen(posting);
        screeningById.set(String(posting.id), result);
      } catch (error) {
        if (error.fatal) throw error;
        screeningById.set(String(posting.id), { decision: 'defer', reason: error.message });
        report.failures.push({ postingId: posting.id, phase: 'prescreening', reason: error.message });
        for (const remaining of candidates.slice(index + 1))
          screeningById.set(String(remaining.id), { decision: 'defer', reason: 'Screening was stopped after an earlier evaluator failure.' });
        break;
      }
    }
  }

  const fetchCandidates = [];
  for (const posting of candidates) {
    const row = screeningById.get(String(posting.id));
    const decision = ['fetch', 'skip', 'defer'].includes(row?.decision) ? row.decision : 'defer';
    const outcome = { postingId: String(posting.id), decision,
      ...(row?.relevanceProbability !== undefined ? { relevanceProbability: row.relevanceProbability } : {}),
      ...(row?.answer ? { answer: row.answer } : {}),
      ...(row?.reason ? { reason: row.reason } : {}) };
    report.prescreening.push(outcome);
    if (decision === 'skip') {
      report.excluded++;
      pending.delete(String(posting.id));
      await persist();
      continue;
    }
    if (decision === 'defer') {
      report.deferred++;
      if (row?.reason) report.failures.push({ postingId: posting.id, phase: 'prescreening', reason: row.reason });
      else if (!row?.answer) report.failures.push({ postingId: posting.id, phase: 'prescreening', reason: 'No screening result; candidate deferred.' });
      await persist();
      continue;
    }
    report.qualified++;
    fetchCandidates.push(posting);
  }

  async function ingestCandidate(posting, opportunity) {
    await emit('ingesting', { postingId: String(posting.id), qualified: report.qualified, added: report.added.length });
    const result = await ingest([opportunity], { requestId: 'linkedin-discovery-v2', minimumScore, skipExisting: true });
    report.screening.push(...result.screeningRows);
    let verified = !result.failed && !result.needsReview && !result.updated;
    if (!verified) report.complete = false;
    for (const added of result.addedRows) {
      const job = await read(added.id);
      if (!job || admissionDecision(job.jevAssessment || {}, minimumScore) !== 'accepted' ||
          !job.overviewSummary?.position?.trim() || !job.overviewSummary?.fit?.trim()) {
        report.complete = false;
        verified = false;
        report.failures.push({ postingId: posting.id, id: added.id, reason: 'Saved assessment or Overview summary could not be verified' });
      } else { report.added.push(added); jobs.push(job); }
    }
    if (verified) {
      pending.delete(String(posting.id));
      processed[String(posting.id)] = window.before;
    }
    await persist();
    if (result.failed || result.needsReview || result.updated) report.failures.push({ postingId: posting.id, phase: 'ingest', reason: 'Assessment or save needs review.' });
  }

  for (const posting of fetchCandidates) {
    const id = String(posting.id);
    try {
      const identity = { ...posting, externalId: `linkedin-${posting.id}` };
      const existing = findExistingJobIn(jobs, identity);
      if (existing) {
        report.existing.push({ postingId: posting.id, id: existing.id, archived: !!existing.archived, stage: existing.stage });
        pending.delete(id);
        processed[id] = window.before;
        await persist();
        continue;
      }
      const cacheReused = !!posting.opportunity;
      await emit('fetching', { postingId: id, descriptionsFetched: report.descriptionsFetched,
        descriptionRequests: report.descriptionRequests, cachedDescriptionsUsed: report.cachedDescriptionsUsed,
        qualified: report.qualified });
      let opportunity = posting.opportunity;
      if (cacheReused) report.cachedDescriptionsUsed++;
      else {
        report.descriptionRequests++;
        opportunity = await describe(posting);
        report.descriptionsFetched++;
      }
      pending.set(id, { ...posting, opportunity });
      await persist();
      await ingestCandidate(posting, opportunity);
    } catch (error) {
      if (error.fatal) throw error;
      report.complete = false;
      report.failures.push({ postingId: posting.id, phase: 'description-or-ingest', reason: error.message });
      await persist();
      if (error.stop) break;
    }
  }

  await persist();
  report.deferred = [...pending.keys()].filter(id => currentIds.has(id)).length;
  report.pendingBacklog = pending.size - report.deferred;
  report.timings[currentPhase] = (report.timings[currentPhase] || 0) + Date.now() - phaseStarted;
  report.timings.total = Date.now() - started;
  const failedWork = report.failures.length > 0;
  report.status = failedWork || !found.complete ? 'incomplete'
    : report.deferred || report.pendingBacklog ? 'deferred' : 'completed';
  // `complete` means the configured daily result scope completed successfully;
  // it does not claim that LinkedIn's full market or deferred backlog is exhausted.
  report.complete = !failedWork && found.complete;
  await progress({ phase: report.status, elapsedMs: report.timings.total, discovered: report.discovered,
    existing: report.existing.length, qualified: report.qualified, excluded: report.excluded,
    deferred: report.deferred, pendingBacklog: report.pendingBacklog,
    searchCoverageComplete: report.searchCoverageComplete, added: report.added.length, timings: report.timings });
  return report;
}
