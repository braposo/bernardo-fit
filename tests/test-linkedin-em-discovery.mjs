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

await test('pagination keeps every unique result beyond the old forty-card ceiling', () => withEmPolicy(async () => {
  const card = id => `<li><div data-entity-urn="urn:li:jobPosting:${id}"><h3>Engineering Manager</h3><h4>Company ${id}</h4>` +
    `<span class="job-search-card__location">Leeds</span></div></li>`;
  const pages = [Array.from({ length: 40 }, (_, index) => index + 1),
    Array.from({ length: 40 }, (_, index) => index + 39)];
  const offsets = [];
  const result = await searchLinkedIn({ window: linkedinWindow(null, new Date('2026-10-01T08:00:00Z')),
    searches: [{ keywords: 'Engineering Manager', location: 'United Kingdom' }],
    fetchImpl: async url => {
      const offset = Number(new URL(url).searchParams.get('start') || 0);
      offsets.push(offset);
      const ids = pages[offset === 0 ? 0 : offset === 40 ? 1 : 2];
      return new Response(ids ? ids.map(card).join('') : 'No matching jobs found');
    },
  });
  assert.deepEqual(offsets, [0, 40, 80]);
  assert.equal(result.jobs.length, 78);
  assert.equal(new Set(result.jobs.map(job => job.id)).size, 78, 'overlapping pages deduplicate IDs');
  assert.equal(result.complete, true);
}));

await test('a repeated full search page reports incomplete coverage instead of claiming all roles were checked', () => withEmPolicy(async () => {
  const html = Array.from({ length: 40 }, (_, index) =>
    `<li><div data-entity-urn="urn:li:jobPosting:${index + 1}"><h3>Engineering Manager</h3><h4>Company</h4></div></li>`).join('');
  let pages = 0;
  const result = await searchLinkedIn({ window: linkedinWindow(null, new Date('2026-10-01T08:00:00Z')),
    searches: [{ keywords: 'Engineering Manager', location: 'United Kingdom' }],
    fetchImpl: async () => { pages++; return new Response(html); },
  });
  assert.equal(pages, 2, 'an unchanged page cannot cause endless requests');
  assert.equal(result.jobs.length, 40);
  assert.equal(result.complete, false, 'repeated pages do not prove complete search coverage');
}));

await test('daily discovery enriches all qualified cards, including onsite and old backlog, without enriching uncertainty', () => withEmPolicy(async () => {
  const qualified = [posting(1, 'Engineering Manager', 'On-site, Leeds'),
    posting(2, 'Engineering Manager', 'Remote, UK'), ...[3, 4, 5, 6, 7].map(id => posting(id))];
  const unrelated = posting(8, 'Sales Manager');
  const uncertain = posting(9, 'Engineering Manager');
  const existing = posting(10);
  const stale = qualified[6];
  const batchInputs = [], described = [], ingested = [];
  let savedState;
  const report = await discoverLinkedIn({ now: new Date('2026-10-01T08:00:00Z'),
    state: { pending: [{ ...stale, preliminary: { decision: 'skip', assessedAt: '2026-09-01' } }] },
    search: async () => ({ jobs: [...qualified.slice(0, 6), qualified[0], unrelated, uncertain, existing], scans: [], complete: true }),
    list: async () => [{ ...existing, externalId: 'linkedin-10', archived: true, stage: 'rejected' }],
    prescreenBatch: async cards => {
      batchInputs.push(...cards.map(card => card.id));
      return cards.map(card => ({ postingId: card.id, decision: card.id === '8' ? 'skip' : card.id === '9' ? 'defer' : 'fetch' }));
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
  assert.equal(new Set(batchInputs).size, 9);
  assert.equal(batchInputs.length, 9, 'existing rows and duplicate cards never reach Jev');
  assert.equal(report.existing.length, 1);
  assert.deepEqual(new Set(described), new Set(['1', '2', '3', '4', '5', '6', '7']));
  assert.equal(described.length, 7, 'all seven qualified roles receive full descriptions, beyond any top-five cutoff');
  assert.deepEqual(new Set(ingested), new Set(described.map(id => `linkedin-${id}`)));
  assert.equal(report.added.length, 7);
  assert.equal(savedState.pending.length, 1);
  assert.equal(savedState.pending[0].id, '9', 'uncertain card remains pending for later review');
  assert.equal(described.includes('8'), false);
  assert.equal(described.includes('9'), false);
  assert.equal(batchInputs.includes('7'), true, 'old pending card is assessed again');
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
