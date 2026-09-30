import assert from 'node:assert/strict';
import { londonSchedule, dispatchLinkedIn } from '../functions/discover-linkedin/schedule.js';
import { parseLinkedInResults, linkedinWindow, searchLinkedIn, linkedinOpportunity } from '../lib/linkedin-source.js';
import { discoverLinkedIn } from '../lib/linkedin-discovery.js';
import { linkedinRequest } from '../lib/linkedin-request.js';
import { screenLinkedInCard } from '../lib/linkedin-card-screening.js';
import { executeIngestBatch } from '../lib/ingest-work.js';
import { createJobIfAbsent, getJob } from '../lib/store.js';

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; } catch (e) { failed++; console.error('FAIL', name, e); } }
await test('London schedule follows GMT, BST and transition days', () => {
  for (const date of ['2026-01-01','2026-03-28','2026-10-25']) {
    assert.equal(londonSchedule(new Date(`${date}T09:00:00Z`)).due, true);
    assert.equal(londonSchedule(new Date(`${date}T08:00:00Z`)).due, false);
  }
  for (const date of ['2026-03-29','2026-09-28','2026-10-24']) {
    assert.equal(londonSchedule(new Date(`${date}T08:00:00Z`)).due, true);
    assert.equal(londonSchedule(new Date(`${date}T09:00:00Z`)).due, false);
  }
});
await test('window retains overlap and bootstrap seven days', () => {
  const now = new Date('2026-09-28T08:00:00Z');
  assert.equal(linkedinWindow(null, now).after, '2026-09-21T08:00:00.000Z');
  assert.equal(linkedinWindow('2026-09-27T08:00:00Z', now).after, '2026-09-26T08:00:00.000Z');
  assert.throws(() => linkedinWindow('bad', now));
});
await test('scheduler skips the other UTC tick and requires production credentials', async () => {
  const skip = await dispatchLinkedIn({now:new Date('2026-09-28T09:00:00Z'),env:{},trigger:async()=>assert.fail('wrong hour')});
  assert.equal(skip.status,'outside-london-9am');
  await assert.rejects(dispatchLinkedIn({now:new Date('2026-09-28T08:00:00Z'),env:{TRIGGER_SECRET_KEY:'tr_dev_test'}}));
  const keys=[];
  for (let n=0;n<2;n++) {
    const result=await dispatchLinkedIn({now:new Date('2026-09-28T08:00:00Z'),env:{TRIGGER_SECRET_KEY:'tr_prod_test'},
      trigger:async(id,payload,options)=>{assert.equal(id,'linkedin-job-discovery');assert.equal(payload.date,'2026-09-28');keys.push(options.idempotencyKey);return {id:'run_test'};}});
    assert.equal(result.runId,'run_test');
  }
  assert.deepEqual(keys[0],keys[1]);
});
const card = '<li><div data-entity-urn="urn:li:jobPosting:123"><h3>Engineering Manager</h3><h4>Acme &amp; Co</h4><span class="job-search-card__location">Leeds</span><time datetime="2026-09-28"></time></div></li>';
await test('public cards extract factual fields; unknown markup fails closed', () => {
  const [job] = parseLinkedInResults(card);
  assert.equal(job.company, 'Acme & Co'); assert.equal(job.id, '123');
  assert.equal(job.postedDate, '2026-09-28');
  assert.deepEqual(parseLinkedInResults('No matching jobs found'), []);
  assert.throws(() => parseLinkedInResults('<html>something changed</html>'));
});
await test('overlapping searches deduplicate posting IDs and stop on throttling', async () => {
  let calls = 0;
  const searches = [{keywords:'one',location:'UK'},{keywords:'two',location:'UK'},{keywords:'three',location:'UK'},{keywords:'must-not-fetch',location:'UK'}];
  const result = await searchLinkedIn({window:linkedinWindow(null), searches, sleep:async()=>{},
    fetchImpl:async()=> ++calls === 3 ? new Response('',{status:429}) : new Response(card)});
  assert.equal(result.jobs.length, 1); assert.equal(result.complete, false); assert.equal(result.blocked, true); assert.equal(calls,3);
});
await test('full original description required, no invented received date', async () => {
  const posting = parseLinkedInResults(card)[0];
  const text = 'Original role responsibilities and requirements. '.repeat(8);
  const opp = await linkedinOpportunity(posting,{fetchImpl:async()=>new Response(`<div class="show-more-less-html__markup">${text}</div>`)});
  assert.equal(opp.externalId,'linkedin-123'); assert.ok(opp.jobDescription.includes('Original'));
  assert.equal(opp.receivedAt,undefined);
  await assert.rejects(linkedinOpportunity(posting,{fetchImpl:async()=>new Response('snippet')}));
});
const posting = id => ({id:String(id),company:`Company ${id}`,role:'Engineering Manager',sourceUrl:`https://www.linkedin.com/jobs/view/${id}`});
const base = {sleep:async()=>{}, list:async()=>[], prescreen:async()=>({decision:'fetch'}), describe:async p=>({...p,externalId:`linkedin-${p.id}`,jobDescription:'Full description'})};
await test('archived jobs preserved and failed summaries leave scan incomplete', async () => {
  let candidates;
  const report = await discoverLinkedIn({...base, list:async()=>[{...posting(1),archived:true,stage:'rejected'}],
    search:async()=>({jobs:[posting(1),posting(2)],scans:[],complete:true}),
    ingest:async(input,options)=>{candidates=input; assert.equal(options.minimumScore,50);assert.equal(options.skipExisting,true);
      return {failed:1,screeningRows:[{decision:'summary-failed'}],addedRows:[]};}});
  assert.equal(candidates.length,1); assert.equal(candidates[0].externalId,'linkedin-2');
  assert.equal(report.existing[0].archived,true);assert.equal(report.complete,false);
});
await test('accepted jobs require persisted assessment and both summaries', async () => {
  const options = {...base, search:async()=>({jobs:[posting(3)],scans:[],complete:true}),
    ingest:async()=>({failed:0,screeningRows:[],addedRows:[{id:'saved'}]}),
    read:async()=>({id:'saved',jevAssessment:{score:50,status:'complete',blocked:false},overviewSummary:{position:'Role',fit:'Fit'}})};
  assert.equal((await discoverLinkedIn(options)).complete,true);
  assert.equal((await discoverLinkedIn({...options,read:async()=>null})).complete,false);
  assert.equal((await discoverLinkedIn({...options,read:async()=>({jevAssessment:{score:80,status:'complete',blocked:true},overviewSummary:{position:'Role',fit:'Fit'}})})).complete,false);
});
await test('blocked search does not fetch descriptions or ingest', async () => {
  const report = await discoverLinkedIn({...base,search:async()=>({jobs:[posting(3)],scans:[],complete:false,blocked:true}),
    describe:async()=>assert.fail('must stop'),ingest:async()=>assert.fail('must stop')});
  assert.equal(report.complete,false);
});
await test('scheduler ingest leaves existing archived row byte-for-byte unchanged', async () => {
  const job = await createJobIfAbsent('existing-test', {externalId:'linkedin-555',company:'Keep',role:'Manager',archived:true,notes:'Private note',stage:'rejected'});
  const before = await getJob(job.id);
  const result = await executeIngestBatch([{externalId:'linkedin-555',company:'Changed',role:'Manager',notes:'Replace'}],
    {skipExisting:true,minimumScore:50,screen:async()=>assert.fail('existing must not be screened')});
  assert.equal(result.skipped,1);assert.deepEqual(await getJob(job.id),before);
});
function clockedRequest(options = {}) {
  let time = Date.parse('2026-09-30T08:00:00Z');
  const waits = [];
  return { waits, request: linkedinRequest({ now: () => time, random: () => 0,
    sleep: async ms => { waits.push(ms); time += ms; }, ...options }) };
}
await test('429 honors Retry-After and spaces every request including retries', async () => {
  let calls = 0;
  const { request, waits } = clockedRequest({ fetchImpl: async () => ++calls === 1
    ? new Response('', { status: 429, headers: { 'Retry-After': '600' } }) : new Response(card) });
  const response = await request('https://www.linkedin.com/test');
  assert.equal(response.status, 200);
  assert.deepEqual(waits, [30_000, 600_000, 30_000]);
  await request('https://www.linkedin.com/test');
  assert.equal(waits.at(-1), 30_000);
});
await test('persistent throttling stops after four attempts and saves a cooldown', async () => {
  let calls = 0, cooldown;
  const { request, waits } = clockedRequest({ fetchImpl: async () => { calls++; return new Response('', { status: 429 }); },
    onCooldown: async until => { cooldown = until; } });
  await assert.rejects(request('https://www.linkedin.com/test'), e => e.stop && /retries exhausted/.test(e.message));
  assert.equal(calls, 4);
  assert.deepEqual(waits, [30_000, 300_000, 30_000, 900_000, 30_000, 1800_000, 30_000]);
  assert.ok(cooldown > Date.parse('2026-09-30T08:50:00Z'));
});
await test('long Retry-After is saved without retrying early or exceeding the budget', async () => {
  let cooldown, calls = 0;
  const { request } = clockedRequest({ fetchImpl: async () => { calls++; return new Response('', {
    status: 429, headers: { 'Retry-After': 'Thu, 01 Oct 2026 12:00:00 GMT' } }); },
    onCooldown: async until => { cooldown = until; } });
  await assert.rejects(request('https://www.linkedin.com/test'), /budget exhausted/);
  assert.equal(calls, 1);
  assert.equal(cooldown, Date.parse('2026-10-01T12:00:00Z'));
  const next = clockedRequest({ notBefore: cooldown, fetchImpl: async () => assert.fail('cooldown still active') });
  await assert.rejects(next.request('https://www.linkedin.com/test'), /budget exhausted/);
});
await test('network failures and temporary server errors retry; redirects and denials do not', async () => {
  let calls = 0;
  const { request } = clockedRequest({ fetchImpl: async () => {
    calls++;
    if (calls === 1) throw new Error('timeout');
    return new Response(card, { status: calls === 2 ? 503 : 200 });
  } });
  assert.equal((await request('https://www.linkedin.com/test')).status, 200);
  assert.equal(calls, 3);
  for (const status of [302, 401, 403, 999]) {
    let attempts = 0;
    const client = clockedRequest({ fetchImpl: async () => { attempts++; return { status, ok: false }; } });
    await assert.rejects(linkedinOpportunity(posting(1), { fetchImpl: client.request }), e => e.stop);
    assert.equal(attempts, 1);
  }
});
await test('search keeps the forty newest cards', async () => {
  const html = Array.from({ length: 60 }, (_, i) => card.replace('jobPosting:123', `jobPosting:${i}`)).join('');
  const result = await searchLinkedIn({ window: linkedinWindow(null), searches: [{keywords:'manager',location:'UK'}],
    sleep: async () => {}, fetchImpl: async () => new Response(html) });
  assert.equal(result.jobs.length, 40);
  assert.equal(result.jobs.at(-1).id, '39');
  assert.equal(result.scans[0].bounded, true);
});
await test('request budget persists backlog and resumes without reprocessing filtered jobs', async () => {
  let state, descriptions = [];
  let budgetReached = true;
  const options = { ...base, now: new Date('2026-09-30T08:00:00Z'),
    search: async () => ({ jobs: [posting(1), posting(2)], scans: [], complete: true }),
    describe: async p => {
      if (p.id === '2' && budgetReached) throw Object.assign(new Error('budget reached'), {stop:true,deferred:true});
      descriptions.push(p.id); return { ...p, externalId: `linkedin-${p.id}` };
    },
    ingest: async () => ({ filtered: 1, screeningRows: [{ decision: 'below-threshold' }], addedRows: [] }),
    saveState: async next => { state = structuredClone(next); } };
  const first = await discoverLinkedIn(options);
  assert.equal(first.status, 'deferred'); assert.equal(first.deferred, 1);
  assert.equal(state.lastSearch, '2026-09-30T08:00:00.000Z');
  budgetReached = false;
  const next = await discoverLinkedIn({ ...options, state, now: new Date('2026-10-01T08:00:00Z') });
  assert.equal(next.complete, true); assert.deepEqual(descriptions, ['1', '2']);
  assert.equal(state.pending.length, 0);
});
await test('failed ingestion retains its fetched description for the next run', async () => {
  let state, calls = 0;
  const options = { ...base, search: async () => ({ jobs: [posting(1)], scans: [], complete: true }),
    describe: async p => { calls++; return { ...p, externalId: 'linkedin-1' }; },
    ingest: async () => ({ failed: 1, screeningRows: [{ decision: 'summary-failed' }], addedRows: [] }),
    saveState: async next => { state = structuredClone(next); } };
  assert.equal((await discoverLinkedIn(options)).status, 'incomplete');
  assert.ok(state.pending[0].opportunity);
  assert.equal((await discoverLinkedIn({ ...options, state,
    ingest: async () => ({ filtered: 1, screeningRows: [], addedRows: [] }) })).complete, true);
  assert.equal(calls, 1);
});
await test('blocked search saves partial discoveries without advancing its search checkpoint', async () => {
  let state;
  const report = await discoverLinkedIn({ ...base, state: { lastSearch: '2026-09-29T08:00:00Z', pending: [posting(1)] },
    search: async () => ({ jobs: [posting(2)], scans: [], complete: false, blocked: true }),
    saveState: async next => { state = structuredClone(next); }, describe: async () => assert.fail('blocked') });
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(state.pending.map(p => p.id), ['1', '2']);
  assert.equal(state.lastSearch, '2026-09-29T08:00:00Z');
});
await test('Jev card screen only rejects high-confidence mismatches and caches by card content', async () => {
  const cache = new Map(); let calls = 0, probability = 0.89;
  const options = { load: async (_, key) => cache.get(key), save: async (_, key, value) => { cache.set(key, value); return value; },
    evaluate: async ({ state, questions, kind }) => {
      calls++; assert.equal(state.card.role, 'Engineering Manager');
      assert.equal(state.card.jobDescription, undefined);
      assert.equal(kind, 'linkedin-card-screen');
      assert.match(questions.relevance.instructions, /unknown, never negative evidence/);
      return { answers: { relevance: { choice: 'mismatch', probabilities: { mismatch: probability, investigate: 1 - probability } } } };
    } };
  assert.equal((await screenLinkedInCard(posting(1), options)).decision, 'fetch');
  await screenLinkedInCard(posting(1), options); assert.equal(calls, 1);
  probability = 0.95;
  assert.equal((await screenLinkedInCard({ ...posting(1), location: 'New evidence' }, options)).decision, 'skip');
  assert.equal(calls, 2);
});
await test('preliminary rejection prevents description requests; every other candidate receives full validation', async () => {
  const described = [], screened = [];
  const report = await discoverLinkedIn({ ...base,
    search: async () => ({ jobs: Array.from({length: 26}, (_, i) => posting(i)), scans: [], complete: true }),
    prescreen: async p => ({ decision: p.id === '0' ? 'skip' : 'fetch' }),
    describe: async p => { described.push(p.id); return {...p,externalId:`linkedin-${p.id}`}; },
    ingest: async batch => { screened.push(...batch); return {filtered:1, screeningRows:[],addedRows:[]}; } });
  assert.equal(described.length, 25); assert.equal(screened.length, 25);
  assert.equal(described.includes('0'), false); assert.equal(report.complete, true);
  assert.equal(report.prescreening.filter(p => p.decision === 'skip').length, 1);
});
await test('Jev pre-screen failure retains the candidate and never fetches its description', async () => {
  let state;
  const report = await discoverLinkedIn({ ...base,
    search: async () => ({ jobs: [posting(1)], scans: [], complete: true }),
    prescreen: async () => { throw new Error('Jev unavailable'); },
    describe: async () => assert.fail('must be screened first'),
    saveState: async next => { state = structuredClone(next); } });
  assert.equal(report.status, 'incomplete'); assert.equal(state.pending.length, 1);
  assert.equal(report.failures[0].phase, 'prescreening');
});
await test('request budget during searches defers normally and preserves discovered cards', async () => {
  let calls = 0, state;
  const report = await discoverLinkedIn({ ...base,
    search: options => searchLinkedIn({ ...options, searches: [{keywords:'one'},{keywords:'two'}], sleep:async()=>{},
      fetchImpl: async () => { if (++calls === 2) throw Object.assign(new Error('budget reached'), {stop:true,deferred:true}); return new Response(card); } }),
    saveState: async next => { state = structuredClone(next); } });
  assert.equal(report.status, 'deferred'); assert.equal(state.pending[0].id, '123');
  assert.equal(state.lastSearch, undefined);
});
console.log(`passed ${passed}, failed ${failed}`);
process.exitCode = failed ? 1 : 0;
