import assert from 'node:assert/strict';
import { DEFAULT_JSEARCH_SETTINGS, validateJSearchSettings } from '../lib/sanity/jsearch-settings.js';
import { initialSettingsDocument } from '../lib/sanity/settings-document.js';
import { settingsFromDocument, withSettingsSnapshot, jsearchSettings, settingsFingerprint } from '../lib/sanity/analysis-settings.js';
import { jsearchPosting, jsearchOpportunity, linkedinIdFrom, fetchJSearchPage, searchJSearch, jsearchRetryPolicy, jsearchCredentials } from '../lib/jsearch-source.js';
import { discoverJSearch } from '../lib/jsearch-discovery.js';

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; } catch (e) { failed++; console.error('FAIL', name, e); } }

const settings = { ...structuredClone(DEFAULT_JSEARCH_SETTINGS), enabled: true };
const job = (n, patch = {}) => ({ job_id: `id-${n}==`, employer_name: `Company ${n}`, job_title: 'Engineering Manager',
  job_publisher: 'Indeed', job_apply_link: `https://uk.indeed.com/viewjob?jk=${n}`, job_description: `Lead the web team ${n}.`,
  job_city: 'Leeds', job_country: 'GB', job_posted_at_datetime_utc: '2026-10-27T08:00:00.000Z', ...patch });

await test('settings validate and stay out of the scoring fingerprint', () => {
  assert.deepEqual(validateJSearchSettings(DEFAULT_JSEARCH_SETTINGS).searches.length, 2);
  for (const patch of [{ enabled: 'yes' }, { searches: [] }, { searches: [{ query: 'EM', country: 'GBR', datePosted: '3days' }] },
    { searches: [{ query: 'EM', country: 'gb', datePosted: 'all' }] }, { pagesPerSearch: 6 }, { maxAssessmentsPerRun: 0 },
    { retry: { ...DEFAULT_JSEARCH_SETTINGS.retry, maxAttempts: 9 } }])
    assert.throws(() => validateJSearchSettings({ ...DEFAULT_JSEARCH_SETTINGS, ...patch }), /JSearch discovery settings/);
  const doc = initialSettingsDocument();
  const withSearch = settingsFromDocument(doc);
  const without = settingsFromDocument({ ...doc, jsearchDiscovery: undefined });
  assert.equal(withSearch.fingerprint, without.fingerprint);
  withSettingsSnapshot(withSearch, () => assert.equal(jsearchSettings().enabled, false));
  withSettingsSnapshot(without, () => assert.equal(jsearchSettings(), null));
  withSettingsSnapshot(withSearch, () => assert.ok(settingsFingerprint()));
});

await test('credentials prefer the direct key and never need both', () => {
  assert.equal(jsearchCredentials({}), null);
  assert.equal(jsearchCredentials({ JSEARCH_API_KEY: ' k ' }).headers['x-api-key'], 'k');
  const rapid = jsearchCredentials({ JSEARCH_RAPIDAPI_KEY: 'r' });
  assert.equal(rapid.headers['x-rapidapi-host'], 'jsearch.p.rapidapi.com');
  assert.match(rapid.url, /^https:\/\/jsearch\.p\.rapidapi\.com\/search$/);
});

await test('a LinkedIn listing takes the LinkedIn identity', () => {
  assert.equal(linkedinIdFrom('https://www.linkedin.com/jobs/view/engineering-manager-at-acme-4012345678?trk=x'), '4012345678');
  assert.equal(linkedinIdFrom('https://uk.linkedin.com/jobs/view/4012345678/'), '4012345678');
  assert.equal(linkedinIdFrom('https://linkedin.evil.com/jobs/view/4012345678'), '');
  assert.equal(linkedinIdFrom('http://www.linkedin.com/jobs/view/4012345678'), '');
  const posting = jsearchPosting(job(1, { apply_options: [{ publisher: 'LinkedIn', apply_link: 'https://www.linkedin.com/jobs/view/em-at-co-4012345678', is_direct: false }] }));
  const opp = jsearchOpportunity(posting);
  assert.equal(opp.externalId, 'linkedin-4012345678');
  assert.equal(opp.sourceUrl, 'https://www.linkedin.com/jobs/view/4012345678');
  assert.equal(opp.source, 'JSearch · Indeed');
});

await test('other listings prefer the direct apply link and keep salary and dates', () => {
  const posting = jsearchPosting(job(2, { job_is_remote: true, job_min_salary: 90000, job_max_salary: 110000.4,
    job_salary_currency: 'GBP', job_salary_period: 'YEAR',
    apply_options: [{ publisher: 'Acme careers', apply_link: 'https://acme.example/jobs/2', is_direct: true }] }));
  assert.match(posting.id, /^js[0-9a-f]{16}$/);
  assert.equal(posting.postedDate, '2026-10-27');
  const opp = jsearchOpportunity(posting);
  assert.equal(opp.sourceUrl, 'https://acme.example/jobs/2');
  assert.equal(opp.externalId, `jsearch-${posting.id.slice(2)}`);
  assert.equal(opp.salary, '£90,000 to £110,000 a year');
  assert.equal(opp.locationMode, 'remote');
  assert.equal(opp.location, 'Leeds, GB');
  assert.equal(jsearchPosting(job(3, { employer_name: ' ' })), null);
  assert.equal(jsearchPosting(job(4, { job_min_salary: null })).salary, '');
});

await test('one page request sends the key in a header and maps provider failures', async () => {
  const policy = settings;
  let seen;
  const ok = async (url, options) => { seen = { url, options };
    return new Response(JSON.stringify({ status: 'OK', data: [job(1, { extra: 'dropped', apply_options: [{ publisher: 'X', apply_link: 'https://x.example/1', is_direct: true, extra: 1 }] })] }), { status: 200 }); };
  const result = await fetchJSearchPage({ params: { query: 'EM', page: '1' }, policy }, { env: { JSEARCH_API_KEY: 'secret' }, fetchRequest: ok });
  assert.equal(new URL(seen.url).searchParams.get('query'), 'EM');
  assert.ok(!seen.url.includes('secret'));
  assert.equal(seen.options.headers['x-api-key'], 'secret');
  assert.equal(seen.options.timeoutInMs, 30000);
  assert.equal(result.jobs[0].extra, undefined);
  assert.deepEqual(result.jobs[0].apply_options, [{ publisher: 'X', apply_link: 'https://x.example/1', is_direct: true }]);

  await assert.rejects(fetchJSearchPage({ params: {}, policy }, { env: {} }), error => error.name === 'AbortTaskRunError');
  const status = (code, headers = {}) => async () => new Response('', { status: code, headers });
  await assert.rejects(fetchJSearchPage({ params: {}, policy }, { env: { JSEARCH_API_KEY: 'k' }, fetchRequest: status(429, { 'retry-after': '120' }) }),
    error => error.name !== 'AbortTaskRunError' && error.retryAt instanceof Date);
  await assert.rejects(fetchJSearchPage({ params: {}, policy }, { env: { JSEARCH_API_KEY: 'k' }, fetchRequest: status(403) }),
    error => error.name === 'AbortTaskRunError');
  await assert.rejects(fetchJSearchPage({ params: {}, policy }, { env: { JSEARCH_API_KEY: 'k' },
    fetchRequest: async () => new Response(JSON.stringify({ status: 'ERROR' }), { status: 200 }) }), error => error.name === 'AbortTaskRunError');

  assert.deepEqual(jsearchRetryPolicy({ payload: { policy }, error: { name: 'AbortTaskRunError' }, ctx: { attempt: { number: 1 } } }), { skipRetrying: true });
  assert.deepEqual(jsearchRetryPolicy({ payload: { policy }, error: new Error('x'), ctx: { attempt: { number: 3 } } }), { skipRetrying: true });
  assert.equal(jsearchRetryPolicy({ payload: { policy }, error: new Error('x'), ctx: { attempt: { number: 1 } } }).retry, policy.retry);
});

await test('search stops on a short page and records a failed search', async () => {
  const calls = [];
  const request = async params => {
    calls.push(params);
    if (params.query.startsWith('Head')) throw new Error('JSearch request failed: HTTP 500');
    return { jobs: params.page === '1' ? Array.from({ length: 10 }, (_, n) => job(n)) : [job(1), job(20)] };
  };
  const found = await searchJSearch({ settings, request });
  assert.deepEqual(calls.map(c => `${c.query.split(' ')[0]}:${c.page}`), ['Engineering:1', 'Engineering:2', 'Head:1']);
  assert.equal(calls[0].date_posted, '3days');
  assert.equal(calls[0].country, 'gb');
  assert.equal(found.postings.length, 11);
  assert.equal(found.complete, false);
  assert.equal(found.scans[1].status, 'failed');
});

await test('discovery skips known postings, drops confident mismatches and caps assessments', async () => {
  const jobs = [job(1), job(2), job(3), job(4), job(5), job(6, { job_description: '' })];
  const processedId = jsearchPosting(job(5)).id;
  let saved;
  const ingested = [];
  const report = await discoverJSearch({
    settings: { ...settings, searches: [settings.searches[0]], pagesPerSearch: 1, maxAssessmentsPerRun: 1 },
    request: async () => ({ jobs }),
    state: { processed: { [processedId]: new Date().toISOString(), stale: '2026-01-01T00:00:00Z' } },
    saveState: async state => { saved = structuredClone(state); },
    list: async () => [{ id: 'job-1', company: 'Company 1', role: 'Engineering Manager', externalId: 'other', stage: 'applied' }],
    listFiltered: async () => [],
    screen: async postings => postings.map(p => ({ postingId: p.id,
      decision: p.company === 'Company 2' ? 'skip' : 'defer', ...(p.company === 'Company 4' ? {} : {}) })),
    ingest: async ([opp]) => { ingested.push(opp.company);
      return { addedRows: [{ id: 'new', company: opp.company }], screeningRows: [], repeatedRows: [], filtered: 0, filteredRecorded: 0 }; },
  });
  assert.equal(report.existing.length, 1);
  assert.equal(report.alreadyProcessed, 1);
  assert.equal(report.noDescription, 1);
  assert.equal(report.excluded, 1);
  assert.deepEqual(ingested, ['Company 3']);
  assert.equal(report.overCap, 1);
  assert.equal(report.status, 'capped');
  assert.equal(saved.processed.stale, undefined);
  assert.ok(saved.processed[jsearchPosting(job(3)).id]);
  assert.equal(saved.processed[jsearchPosting(job(4)).id], undefined);
});

await test('evaluator failures and failed ingests are retried on the next run', async () => {
  let saved = { processed: {} };
  const report = await discoverJSearch({
    settings: { ...settings, searches: [settings.searches[0]], pagesPerSearch: 1 },
    request: async () => ({ jobs: [job(1), job(2)] }),
    saveState: async state => { saved = structuredClone(state); },
    list: async () => [], listFiltered: async () => [],
    screen: async postings => postings.map(p => p.company === 'Company 1'
      ? { postingId: p.id, decision: 'defer', reason: 'Jev batch screening failed: 529' } : { postingId: p.id, decision: 'fetch' }),
    ingest: async () => ({ addedRows: [], screeningRows: [], repeatedRows: [], failed: 1 }),
  });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.failures.length, 2);
  assert.deepEqual(saved.processed, {});
});

console.log(`passed ${passed}, failed ${failed}`);
if (failed) process.exit(1);
