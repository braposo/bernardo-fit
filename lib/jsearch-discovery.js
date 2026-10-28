import { searchJSearch, jsearchOpportunity } from './jsearch-source.js';
import { listJobs, findExistingJobIn } from './store.js';
import { executeIngestBatch, repeatStore, repeatRecords } from './ingest-work.js';
import { findRepeat } from './job-duplicates.js';
import { ingestMinimumScore } from './ingest-screening.js';
import { screenLinkedInCards } from './linkedin-card-screening.js';
import { recordFilteredJobs } from './filtered-jobs.js';

const PROCESSED_DAYS = 30;

// Daily JSearch discovery. Every result already carries its full description, so
// the card screen only drops confident mismatches; uncertain cards go on to the
// full assessment, within the published per-run assessment cap.
export async function discoverJSearch({ settings, request, now = new Date(), state = {}, saveState = async () => {},
  list = listJobs, ingest = executeIngestBatch, screen = screenLinkedInCards, listFiltered = repeatStore.listFiltered,
  recordFiltered = recordFilteredJobs, progress = async () => {} }) {
  const stamp = now.toISOString();
  const processed = Object.fromEntries(Object.entries(state.processed || {})
    .filter(([, date]) => Date.parse(date) > now.getTime() - PROCESSED_DAYS * 86400000));
  const persist = () => saveState({ processed });
  const done = async id => { processed[id] = stamp; await persist(); };

  await progress({ phase: 'searching' });
  const found = await searchJSearch({ settings, request,
    onPage: page => progress({ phase: 'searching', query: page.query, page: page.page, found: page.found }) });
  const report = { scans: found.scans, searchComplete: found.complete, discovered: found.postings.length,
    alreadyProcessed: 0, existing: [], noDescription: 0, excluded: 0, overCap: 0, assessed: 0, added: [], repeats: [],
    filtered: 0, filteredRecorded: 0, screening: [], prescreening: [], failures: [] };

  const jobs = await list({ includeArchived: true });
  const candidates = [], likelyReposts = new Set();
  let repeatSources = null;
  for (const posting of found.postings) {
    if (processed[posting.id]) { report.alreadyProcessed++; continue; }
    const opportunity = jsearchOpportunity(posting);
    const existing = findExistingJobIn(jobs, opportunity);
    if (existing) {
      report.existing.push({ postingId: posting.id, id: existing.id, archived: !!existing.archived, stage: existing.stage });
      await done(posting.id);
      continue;
    }
    if (!posting.jobDescription) { report.noDescription++; await done(posting.id); continue; }
    // A likely repost skips the card screen: the ingest batch compares descriptions.
    repeatSources ||= repeatRecords(jobs, await listFiltered());
    if (findRepeat(opportunity, repeatSources).rules.length) likelyReposts.add(posting.id);
    candidates.push({ posting, opportunity });
  }

  const toScreen = candidates.filter(({ posting }) => !likelyReposts.has(posting.id)).map(({ posting }) => posting);
  await progress({ phase: 'screening', candidates: candidates.length, screenTotal: toScreen.length });
  const screened = new Map();
  if (toScreen.length) {
    try { for (const row of await screen(toScreen) || []) if (row) screened.set(String(row.postingId), row); }
    catch (error) {
      if (error.fatal) throw error;
      report.failures.push({ phase: 'prescreening', reason: error.message, count: toScreen.length });
    }
  }

  const toAssess = [];
  for (const candidate of candidates) {
    const id = candidate.posting.id;
    if (likelyReposts.has(id)) { toAssess.push(candidate); continue; }
    const row = screened.get(id);
    if (!row || (row.decision === 'defer' && row.reason)) {
      // The evaluator failed for this card: retry it on the next run.
      if (row?.reason) report.failures.push({ postingId: id, phase: 'prescreening', reason: row.reason });
      continue;
    }
    report.prescreening.push({ postingId: id, decision: row.decision,
      ...(row.relevanceProbability !== undefined ? { relevanceProbability: row.relevanceProbability } : {}) });
    if (row.decision === 'skip') { report.excluded++; await done(id); continue; }
    toAssess.push(candidate);
  }

  const minimumScore = ingestMinimumScore();
  for (const [index, { posting, opportunity }] of toAssess.entries()) {
    // Left unprocessed, so a later run within the date window can still reach it.
    if (index >= settings.maxAssessmentsPerRun) { report.overCap = toAssess.length - index; break; }
    await progress({ phase: 'ingesting', postingId: posting.id, assessed: report.assessed, added: report.added.length });
    try {
      const result = await ingest([{ ...opportunity, ...(posting.postedDate ? { postedDate: posting.postedDate } : {}) }],
        { requestId: 'jsearch-discovery', minimumScore, skipExisting: true, recordFiltered });
      report.assessed++;
      report.screening.push(...result.screeningRows);
      report.repeats.push(...(result.repeatedRows || []).map(row => ({ postingId: posting.id, ...row })));
      report.filtered += result.filtered || 0;
      report.filteredRecorded += result.filteredRecorded || 0;
      for (const added of result.addedRows) { report.added.push(added); jobs.push({ ...opportunity, id: added.id }); }
      if (result.failed || result.needsReview) report.failures.push({ postingId: posting.id, phase: 'ingest', reason: 'Assessment or save needs review.' });
      else await done(posting.id);
    } catch (error) {
      if (error.fatal) throw error;
      report.failures.push({ postingId: posting.id, phase: 'ingest', reason: error.message });
    }
  }

  report.status = report.failures.length || !found.complete ? 'incomplete' : report.overCap ? 'capped' : 'completed';
  await progress({ phase: report.status, discovered: report.discovered, added: report.added.length,
    assessed: report.assessed, excluded: report.excluded, overCap: report.overCap });
  return report;
}
