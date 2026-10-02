import assert from 'node:assert/strict';
import { screenLinkedInCards } from '../lib/linkedin-card-screening.js';
import { discoverLinkedIn } from '../lib/linkedin-discovery.js';
import { linkedinWindow, searchLinkedIn } from '../lib/linkedin-source.js';
import { analysisSettings, linkedinSettings, withSettingsSnapshot } from '../lib/sanity/analysis-settings.js';
import { findExistingJobIn, linkedinPostingId } from '../lib/store.js';
import { executeIngestBatch, ingestIdentity } from '../lib/ingest-work.js';

let passed = 0, failed = 0;
async function test(name, run) {
  try { await run(); passed++; }
  catch (error) { failed++; console.error('FAIL', name, error); }
}
const withEmPolicy = run => withSettingsSnapshot({ ...analysisSettings(),
  linkedinScreening: { ...linkedinSettings(), enabled: true, relevanceProbability: 0.8, maxSearchPages: 4 },
}, run);
const posting = (id, role = 'Engineering Manager', location = 'Leeds, England') => ({
  id: String(id), role, location, company: `Company ${id}`,
  sourceUrl: `https://www.linkedin.com/jobs/view/${id}`,
});

await test('batched Jev decisions use probability, preserve uncertainty, and reuse each card result', () => withEmPolicy(async () => {
  const cards = [posting(1, 'Engineering Manager', 'On-site, Leeds'),
    posting(2, 'Engineering Manager', 'Remote, UK'), posting(3, 'Sales Manager'),
    posting(4, 'Engineering Manager', 'Manchester')];
  const cache = new Map();
  let evaluations = 0;
  const options = {
    load: async (_, key) => cache.get(key),
    save: async (_, key, value) => { cache.set(key, value); return value; },
    evaluate: async ({ questions }) => {
      evaluations++;
      assert.equal(Object.keys(questions).length, 4, 'one bounded model call assesses all four uncached cards');
      const probabilities = [
        { investigate: 0.84, mismatch: 0.16 },
        { investigate: 0.79, mismatch: 0.21 },
        { investigate: 0.06, mismatch: 0.94 },
        { investigate: 0.92, mismatch: 0.08 },
      ];
      return { answers: Object.fromEntries(Object.keys(questions).map((key, index) => [key, {
        type: 'choice',
        choice: index === 2 || index === 3 ? 'mismatch' : 'investigate',
        probabilities: probabilities[index],
      }])) };
    },
  };
  const first = await screenLinkedInCards(cards, options);
  assert.deepEqual(first.map(row => row.postingId), ['1', '2', '3', '4']);
  assert.deepEqual(first.map(row => row.decision), ['fetch', 'defer', 'skip', 'defer'],
    'both the positive choice and its confidence are required for enrichment');
  assert.equal(first[0].relevanceProbability, 0.84);
  assert.equal(evaluations, 1);
  assert.deepEqual(await screenLinkedInCards(cards, options), first);
  assert.equal(evaluations, 1, 'a retry reuses per-card assessments without another paid call');
  await withSettingsSnapshot({ ...analysisSettings(), linkedinScreening: { ...linkedinSettings(),
    requestTimeoutSeconds: linkedinSettings().requestTimeoutSeconds + 1 } }, async () => {
    assert.deepEqual(await screenLinkedInCards(cards, options), first);
  });
  assert.equal(evaluations, 1, 'transport timeout edits cannot invalidate relevance evidence');
  await withSettingsSnapshot({ ...analysisSettings(), linkedinScreening: { ...linkedinSettings(), maxSearchResults: 79 } }, async () => {
    assert.deepEqual(await screenLinkedInCards(cards, options), first);
  });
  assert.equal(evaluations, 1, 'the daily result budget does not invalidate per-card screening cache');
}));

await test('malformed Jev probabilities cannot admit a card or poison its cache', () => withEmPolicy(async () => {
  let saved = 0;
  const bad = { load: async () => null, save: async () => { saved++; },
    evaluate: async ({ questions }) => ({ answers: Object.fromEntries(Object.keys(questions).map(key => [key, {
      type: 'choice', choice: 'investigate', probabilities: { investigate: 1.7, mismatch: -0.7 },
    }])) }),
  };
  const [result] = await screenLinkedInCards([posting(50)], bad);
  assert.equal(result.decision, 'defer');
  assert.match(result.reason, /valid LinkedIn relevance answer/);
  assert.equal(saved, 0);
}));

await test('guest continuation follows actual card counts, scopes main results, and does not stop at short pages', () => withEmPolicy(async () => {
  const card = id => `<li><div data-entity-urn="urn:li:jobPosting:${id}"><h3>Engineering Manager</h3><h4>Company ${id}</h4>` +
    `<span class="job-search-card__location">Leeds</span></div></li>`;
  const urls = [];
  const first = Array.from({ length: 60 }, (_, index) => index + 1);
  const second = Array.from({ length: 10 }, (_, index) => index + 60);
  const third = [70, 71];
  const result = await searchLinkedIn({ window: linkedinWindow(null, new Date('2026-10-01T08:00:00Z')),
    searches: [{ keywords: 'Engineering Manager', location: 'United Kingdom' }],
    fetchImpl: async url => {
      const parsed = new URL(url);
      urls.push({ path: parsed.pathname, start: Number(parsed.searchParams.get('start')) });
      const start = Number(parsed.searchParams.get('start'));
      if (start === 0) return new Response(`<section class="two-pane-serp-page__results-list"><ul class="jobs-search__results-list">${first.map(card).join('')}</ul></section><aside>${card(999)}</aside>`);
      if (start === 60) return new Response(second.map(card).join(''));
      if (start === 70) return new Response(third.map(card).join(''));
      return new Response('  \n');
    },
  });
  assert.deepEqual(urls, [
    { path: '/jobs/search/', start: 0 },
    { path: '/jobs-guest/jobs/api/seeMoreJobPostings/search', start: 60 },
    { path: '/jobs-guest/jobs/api/seeMoreJobPostings/search', start: 70 },
    { path: '/jobs-guest/jobs/api/seeMoreJobPostings/search', start: 72 },
  ]);
  assert.equal(result.jobs.length, 71);
  assert.equal(new Set(result.jobs.map(job => job.id)).size, 71, 'overlapping posting IDs deduplicate');
  assert.ok(!result.jobs.some(job => job.id === '999'), 'sidebar cards are excluded');
  assert.equal(result.complete, true);
}));

await test('daily policy stops after 80 unique results, counts overlaps once, and completes the bounded scope', () => withEmPolicy(async () => {
  const card = id => `<li><div data-entity-urn="urn:li:jobPosting:${id}"><h3>Engineering Manager</h3><h4>Company ${id}</h4></div></li>`;
  const page = ids => ids.map(card).join('');
  const urls = [];
  const first = Array.from({ length: 60 }, (_, index) => index + 1);
  const second = [...Array.from({ length: 15 }, (_, index) => index + 46), ...Array.from({ length: 15 }, (_, index) => index + 61)];
  const third = Array.from({ length: 20 }, (_, index) => index + 76);
  const result = await searchLinkedIn({ window: linkedinWindow(null, new Date('2026-10-01T08:00:00Z')),
    searches: [{ keywords: 'Engineering Manager', location: 'United Kingdom' }],
    fetchImpl: async url => {
      const parsed = new URL(url);
      const start = Number(parsed.searchParams.get('start'));
      urls.push(start);
      if (start === 0) return new Response(`<section class="two-pane-serp-page__results-list"><ul class="jobs-search__results-list">${page(first)}</ul></section>`);
      if (start === 60) return new Response(page(second));
      if (start === 90) return new Response(page(third));
      assert.fail(`unexpected extra search request at offset ${start}`);
    },
  });
  assert.deepEqual(urls, [0, 60, 90], 'offset advances by raw cards despite 15 overlapping IDs');
  assert.equal(result.jobs.length, 80);
  assert.equal(new Set(result.jobs.map(job => job.id)).size, 80);
  assert.equal(result.scans[0].found, 80);
  assert.equal(result.scans[0].status, 'bounded');
  assert.equal(result.complete, true);
  assert.equal(result.coverage.completeForConfiguredScope, true);
  assert.equal(result.coverage.maxUniqueResultsPerSearch, 80);
}));

await test('page safety ceiling before maxSearchResults remains incomplete', () => withSettingsSnapshot({
  ...analysisSettings(), linkedinScreening: { ...linkedinSettings(), maxSearchPages: 2 },
}, async () => {
  const card = id => `<li><div data-entity-urn="urn:li:jobPosting:${id}"><h3>Engineering Manager</h3><h4>Company ${id}</h4></div></li>`;
  const calls = [];
  const result = await searchLinkedIn({ window: linkedinWindow(null),
    searches: [{ keywords: 'Engineering Manager', location: 'United Kingdom' }],
    fetchImpl: async url => {
      const start = Number(new URL(url).searchParams.get('start'));
      calls.push(start);
      return new Response(start === 0
        ? `<section class="two-pane-serp-page__results-list"><ul class="jobs-search__results-list">${Array.from({length: 60}, (_, index) => card(index + 1)).join('')}</ul></section>`
        : Array.from({length: 10}, (_, index) => card(index + 61)).join(''));
    },
  });
  assert.deepEqual(calls, [0, 60]);
  assert.equal(result.jobs.length, 70);
  assert.equal(result.complete, false);
  assert.equal(result.scans[0].status, 'partial');
}));

await test('enabled v2 search refuses to use a code fallback before maxSearchResults is published', async () => {
  const policy = { ...linkedinSettings() };
  delete policy.maxSearchResults;
  let calls = 0;
  await withSettingsSnapshot({ ...analysisSettings(), linkedinScreening: { ...policy, enabled: true } }, async () => {
    await assert.rejects(searchLinkedIn({ window: linkedinWindow(null), fetchImpl: async () => { calls++; return new Response(''); } }),
      /valid maxSearchResults/);
  });
  assert.equal(calls, 0, 'configuration must be migrated before public search begins');
});

await test('an HTTP error after a valid first page leaves coverage partial and retains captured cards', () => withEmPolicy(async () => {
  const card = id => `<li><div data-entity-urn="urn:li:jobPosting:${id}"><h3>Engineering Manager</h3><h4>Company ${id}</h4></div></li>`;
  let calls = 0;
  const result = await searchLinkedIn({ window: linkedinWindow(null, new Date('2026-10-01T08:00:00Z')),
    searches: [{ keywords: 'Engineering Manager', location: 'United Kingdom' }],
    fetchImpl: async () => ++calls === 1
      ? new Response(`<section class="two-pane-serp-page__results-list"><ul class="jobs-search__results-list">${card(1)}</ul></section>`)
      : new Response('', { status: 400 }),
  });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.complete, false);
  assert.equal(result.blocked, false);
  assert.equal(result.scans[0].status, 'failed');
}));

await test('a v2 full page without the primary results list fails closed instead of scanning sidebar cards', () => withEmPolicy(async () => {
  const sidebar = `<aside><li><div data-entity-urn="urn:li:jobPosting:999"><h3>Engineering Manager</h3><h4>Sidebar</h4></div></li></aside>`;
  const result = await searchLinkedIn({ window: linkedinWindow(null, new Date('2026-10-01T08:00:00Z')),
    searches: [{ keywords: 'Engineering Manager', location: 'United Kingdom' }],
    fetchImpl: async () => new Response(`<html><body>${sidebar}<p>You've viewed all jobs for this search</p></body></html>`),
  });
  assert.equal(result.jobs.length, 0);
  assert.equal(result.complete, false);
  assert.equal(result.scans[0].status, 'failed');
}));

await test('non-auth pagination failure still processes captured matches without advancing last-success', () => withEmPolicy(async () => {
  const captured = posting(72);
  const oldCheckpoint = '2026-09-30T08:00:00.000Z';
  let described = 0, saved;
  const report = await discoverLinkedIn({
    now: new Date('2026-10-01T08:00:00Z'), state: { lastSearch: oldCheckpoint },
    search: async () => ({ jobs: [captured], scans: [{ status: 'failed', reason: 'LinkedIn HTTP 400' }], complete: false, blocked: false }),
    list: async () => [],
    prescreenBatch: async cards => cards.map(card => ({ postingId: card.id, decision: 'fetch' })),
    describe: async card => { described++; return { ...card, externalId: `linkedin-${card.id}`, jobDescription: 'Full original description' }; },
    ingest: async () => ({ screeningRows: [], addedRows: [{ id: 'linkedin-72' }] }),
    read: async id => ({ id, jevAssessment: { status: 'complete', score: 80 },
      overviewSummary: { position: 'Engineering Manager', fit: 'Strong fit' } }),
    saveState: async state => { saved = structuredClone(state); },
  });
  assert.equal(described, 1);
  assert.equal(report.added.length, 1);
  assert.equal(report.status, 'incomplete');
  assert.equal(saved.lastSearch, oldCheckpoint);
}));

await test('a repeated full search page reports incomplete coverage instead of claiming all roles were checked', () => withEmPolicy(async () => {
  const html = `<section class="two-pane-serp-page__results-list"><ul class="jobs-search__results-list">${Array.from({ length: 40 }, (_, index) =>
    `<li><div data-entity-urn="urn:li:jobPosting:${index + 1}"><h3>Engineering Manager</h3><h4>Company</h4></div></li>`).join('')}</ul></section>`;
  let pages = 0;
  const result = await searchLinkedIn({ window: linkedinWindow(null, new Date('2026-10-01T08:00:00Z')),
    searches: [{ keywords: 'Engineering Manager', location: 'United Kingdom' }],
    fetchImpl: async () => { pages++; return new Response(html); },
  });
  assert.equal(pages, 2, 'an unchanged page cannot cause endless requests');
  assert.equal(result.jobs.length, 40);
  assert.equal(result.complete, false, 'repeated pages do not prove complete search coverage');
}));

await test('daily discovery enriches qualified current cards and leaves out-of-scope pending backlog untouched', () => withEmPolicy(async () => {
  const qualified = [posting(1, 'Engineering Manager', 'On-site, Leeds'),
    posting(2, 'Engineering Manager', 'Remote, UK'), ...[3, 4, 5, 6, 7].map(id => posting(id))];
  const unrelated = posting(8, 'Sales Manager');
  const uncertain = posting(9, 'Engineering Manager');
  const existing = posting(10);
  const stale = qualified[6];
  const batchInputs = [], described = [], ingested = [];
  let savedState;
  const report = await discoverLinkedIn({ now: new Date('2026-10-01T08:00:00Z'),
    state: { pending: [{ ...stale, preliminary: { decision: 'skip', assessedAt: '2026-09-01' } }, posting(900)] },
    search: async () => ({ jobs: [...qualified.slice(0, 6), qualified[0], unrelated, uncertain, existing], scans: [], complete: true }),
    list: async () => [{ ...existing, externalId: 'linkedin-10', archived: true, stage: 'rejected' }],
    prescreenBatch: async cards => {
      batchInputs.push(...cards.map(card => card.id));
      return cards.map(card => ({ postingId: card.id, decision: card.id === '8' ? 'skip' : card.id === '9' ? 'defer' : 'fetch',
        ...(card.id === '9' ? { answer: { choice: 'investigate', probabilities: { investigate: 0.62, mismatch: 0.38 } } } : {}) }));
    },
    describe: async card => { described.push(card.id); return { ...card, externalId: `linkedin-${card.id}`, jobDescription: 'Full original description' }; },
    ingest: async batch => {
      ingested.push(...batch.map(job => job.externalId));
      return { screeningRows: [], addedRows: batch.map(job => ({ id: job.externalId })) };
    },
    read: async id => ({ id, jevAssessment: { status: 'complete', score: 80 },
      overviewSummary: { position: 'Engineering Manager', fit: 'Strong fit' } }),
    saveState: async state => { savedState = structuredClone(state); },
  });
  assert.equal(new Set(batchInputs).size, 8);
  assert.equal(batchInputs.length, 8, 'existing rows, duplicates, and out-of-scope pending cards never reach Jev');
  assert.equal(report.existing.length, 1);
  assert.deepEqual(new Set(described), new Set(['1', '2', '3', '4', '5', '6']));
  assert.equal(described.length, 6, 'all six in-scope qualified roles receive full descriptions');
  assert.deepEqual(new Set(ingested), new Set(described.map(id => `linkedin-${id}`)));
  assert.equal(report.added.length, 6);
  assert.deepEqual(new Set(savedState.pending.map(row => row.id)), new Set(['7', '9', '900']), 'uncertain and out-of-scope cards remain pending');
  assert.equal(described.includes('8'), false);
  assert.equal(described.includes('9'), false);
  assert.equal(batchInputs.includes('7'), false, "old pending outside today's result set is not screened");
  assert.equal(batchInputs.includes('900'), false, "old pending outside today's bounded result set is not screened");
  assert.equal(report.pendingBacklog, 2);
  assert.equal(report.deferred, 1);
  assert.equal(report.complete, true, 'completion describes the configured current result scope');
  assert.equal(savedState.lastSearch, '2026-10-01T08:00:00.000Z', 'bounded completion advances the search checkpoint');
  assert.equal(report.status, 'deferred');
}));

await test('a card skipped yesterday can be reconsidered when the screening evidence changes', () => withEmPolicy(async () => {
  const card = posting(70);
  let state;
  const shared = { search: async () => ({ jobs: [card], scans: [], complete: true }),
    list: async () => [], saveState: async next => { state = structuredClone(next); } };
  const first = await discoverLinkedIn({ ...shared, now: new Date('2026-10-01T08:00:00Z'),
    prescreenBatch: async () => [{ postingId: card.id, decision: 'skip' }],
    describe: async () => assert.fail('negative card needs no description'),
  });
  assert.equal(first.excluded, 1);
  let described = 0;
  const second = await discoverLinkedIn({ ...shared, state, now: new Date('2026-10-02T08:00:00Z'),
    prescreenBatch: async () => [{ postingId: card.id, decision: 'fetch' }],
    describe: async () => { described++; return { ...card, externalId: 'linkedin-70', jobDescription: 'Full original description' }; },
    ingest: async () => ({ screeningRows: [], addedRows: [{ id: 'linkedin-70' }] }),
    read: async () => ({ ...card, externalId: 'linkedin-70', jevAssessment: { status: 'complete', score: 80 },
      overviewSummary: { position: 'Engineering Manager', fit: 'Strong fit' } }),
  });
  assert.equal(described, 1);
  assert.equal(second.added.length, 1);
}));

await test('a Jev failure stays pending and marks the daily report incomplete', () => withEmPolicy(async () => {
  const card = posting(75);
  let savedState;
  const report = await discoverLinkedIn({
    search: async () => ({ jobs: [card], scans: [], complete: true }),
    list: async () => [],
    prescreenBatch: async () => [{ postingId: card.id, decision: 'defer', reason: 'Jev unavailable' }],
    describe: async () => assert.fail('failed preliminary screening cannot fetch'),
    saveState: async next => { savedState = structuredClone(next); },
  });
  assert.equal(report.status, 'incomplete');
  assert.equal(savedState.pending.length, 1);
  assert.equal(report.failures[0].phase, 'prescreening');
}));

await test('distinct LinkedIn posting IDs at one company both reach full screening', () => withEmPolicy(async () => {
  const firstCard = posting(80);
  const secondCard = { ...posting(81), company: firstCard.company, role: firstCard.role };
  const described = [], ingested = [];
  const report = await discoverLinkedIn({ now: new Date('2026-10-01T08:00:00Z'),
    search: async () => ({ jobs: [firstCard, secondCard], scans: [], complete: true }),
    list: async () => [],
    prescreenBatch: async cards => cards.map(card => ({ postingId: card.id, decision: 'fetch' })),
    describe: async card => { described.push(card.id); return { ...card, externalId: `linkedin-${card.id}`, jobDescription: 'Full original description' }; },
    ingest: async batch => { ingested.push(batch[0].externalId); return { screeningRows: [], addedRows: [{ id: batch[0].externalId }] }; },
    read: async id => ({ ...firstCard, id, externalId: id, jevAssessment: { status: 'complete', score: 80 },
      overviewSummary: { position: 'Engineering Manager', fit: 'Strong fit' } }),
  });
  assert.deepEqual(described, ['80', '81']);
  assert.deepEqual(ingested, ['linkedin-80', 'linkedin-81']);
  assert.equal(report.added.length, 2);
  assert.equal(report.existing.length, 0);
}));

await test('LinkedIn identity uses numeric posting ID while legacy company-title matching remains', () => {
  const first = { ...posting(90), externalId: 'linkedin-90', sourceUrl: 'https://www.linkedin.com/jobs/view/90?tracking=one' };
  const same = { ...first, sourceUrl: 'https://www.linkedin.com/jobs/view/90?tracking=two' };
  const other = { ...posting(91), company: first.company, role: first.role, externalId: 'linkedin-91' };
  assert.equal(findExistingJobIn([first], same), first);
  assert.equal(findExistingJobIn([first], other), null);
  assert.equal(ingestIdentity(first), ingestIdentity(same));
  assert.notEqual(ingestIdentity(first), ingestIdentity(other));
  const legacy = { company: first.company, role: first.role };
  assert.equal(findExistingJobIn([legacy], other), legacy,
    'old records without a LinkedIn posting ID still match by company and title');
  assert.equal(linkedinPostingId({ externalId: 'linkedin-90', sourceUrl: 'https://www.linkedin.com/jobs/search/' }), '90',
    'a LinkedIn URL without a posting ID falls back to the valid external ID');
});

await test('real ingestion saves distinct LinkedIn openings and skips repeat URLs for each ID', async () => {
  const first = { ...posting(901), externalId: 'linkedin-901', jobDescription: 'First opening' };
  const second = { ...posting(902), company: first.company, role: first.role,
    externalId: 'linkedin-902', jobDescription: 'Second opening' };
  let screened = 0;
  const screen = async () => { screened++; return { decision: 'accepted',
    assessment: { status: 'complete', score: 80 },
    overviewSummary: { position: 'Engineering Manager', fit: 'Strong fit' } }; };
  const initial = await executeIngestBatch([first, second], { requestId: 'linkedin-em-identity',
    minimumScore: 50, skipExisting: true, screen });
  assert.equal(initial.added, 2);
  assert.notEqual(initial.addedRows[0].id, initial.addedRows[1].id);
  assert.equal(screened, 2);
  const repeated = await executeIngestBatch([
    { ...first, sourceUrl: `${first.sourceUrl}?tracking=repeat` },
    { ...second, sourceUrl: `${second.sourceUrl}?tracking=repeat` },
  ], { requestId: 'linkedin-em-identity-repeat', minimumScore: 50, skipExisting: true, screen });
  assert.equal(repeated.added, 0);
  assert.equal(repeated.skipped, 2);
  assert.equal(screened, 2, 'already saved postings never incur another assessment');
});

console.log(`passed ${passed}, failed ${failed}`);
process.exitCode = failed ? 1 : 0;
