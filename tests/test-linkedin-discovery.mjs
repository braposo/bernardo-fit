import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { retry } from '@trigger.dev/sdk';
import { londonSchedule, dispatchLinkedIn } from '../functions/discover-linkedin/schedule.js';
import { parseLinkedInResults, linkedinWindow, searchLinkedIn, linkedinOpportunity } from '../lib/linkedin-source.js';
import { discoverLinkedIn } from '../lib/linkedin-discovery.js';
import { fetchLinkedInPage, retryAfterDate, linkedInRetryPolicy } from '../lib/linkedin-request.js';
import { DEFAULT_LINKEDIN_SETTINGS } from '../lib/sanity/linkedin-settings.js';
import { claimLinkedInSource } from '../lib/linkedin-run-lock.js';
import { screenLinkedInCard } from '../lib/linkedin-card-screening.js';
import { initialSettingsDocument } from '../lib/sanity/settings-document.js';
import { settingsFromDocument, withSettingsSnapshot } from '../lib/sanity/analysis-settings.js';
import { executeIngestBatch } from '../lib/ingest-work.js';
import { createJobIfAbsent, getJob } from '../lib/store.js';

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; } catch (e) { failed++; console.error('FAIL', name, e); } }
function legacyLinkedInSnapshot(patch = {}) {
  const doc = initialSettingsDocument();
  const current = doc.linkedinScreening;
  doc.linkedinScreening = { policyVersion: 1, resultsPerSearch: 40, mismatchProbability: 0.9,
    instructions: current.instructions, investigateCriteria: current.investigateCriteria,
    mismatchCriteria: current.mismatchCriteria, requestMinSeconds: 30, requestMaxSeconds: 60,
    requestTimeoutSeconds: current.requestTimeoutSeconds, retry: structuredClone(current.retry), ...patch };
  return settingsFromDocument(doc);
}
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
  await withSettingsSnapshot(legacyLinkedInSnapshot(), async () => {
    const result = await searchLinkedIn({window:linkedinWindow(null), searches,
      fetchImpl:async()=> ++calls === 3 ? new Response('',{status:429}) : new Response(card)});
    assert.equal(result.jobs.length, 1); assert.equal(result.complete, false); assert.equal(result.blocked, true); assert.equal(calls,3);
  });
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
await test('v1 search keeps its forty newest card compatibility bound', async () => {
  const html = Array.from({ length: 60 }, (_, i) => card.replace('jobPosting:123', `jobPosting:${i}`)).join('');
  await withSettingsSnapshot(legacyLinkedInSnapshot(), async () => {
    const result = await searchLinkedIn({ window: linkedinWindow(null), searches: [{keywords:'manager',location:'UK'}],
      fetchImpl: async () => new Response(html) });
    assert.equal(result.jobs.length, 40);
    assert.equal(result.jobs.at(-1).id, '39');
    assert.equal(result.scans[0].status, 'ok');
  });
});
await test('exhausted request task persists backlog and resumes without reprocessing filtered jobs', async () => {
  let state, descriptions = [];
  let requestFailed = true;
  const options = { ...base, now: new Date('2026-09-30T08:00:00Z'),
    search: async () => ({ jobs: [posting(1), posting(2)], scans: [], complete: true }),
    describe: async p => {
      if (p.id === '2' && requestFailed) throw Object.assign(new Error('budget reached'), {stop:true});
      descriptions.push(p.id); return { ...p, externalId: `linkedin-${p.id}` };
    },
    ingest: async () => ({ filtered: 1, screeningRows: [{ decision: 'below-threshold' }], addedRows: [] }),
    saveState: async next => { state = structuredClone(next); } };
  const first = await discoverLinkedIn(options);
  assert.equal(first.status, 'incomplete'); assert.equal(first.deferred, 1);
  assert.equal(state.lastSearch, '2026-09-30T08:00:00.000Z');
  requestFailed = false;
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
  await withSettingsSnapshot(legacyLinkedInSnapshot(), async () => {
    const cache = new Map(); let calls = 0, probability = 0.89;
    const options = { load: async (_, key) => cache.get(key), save: async (_, key, value) => { cache.set(key, value); return value; },
      evaluate: async ({ state, questions, kind }) => {
        calls++; assert.equal(state.cards['1'].role, 'Engineering Manager');
        assert.equal(state.cards['1'].jobDescription, undefined);
        assert.equal(kind, 'linkedin-card-screen-batch');
        assert.match(questions.card_1.instructions, /Evaluate this posting only/);
        return { answers: { card_1: { choice: 'mismatch', probabilities: { mismatch: probability, investigate: 1 - probability } } } };
      } };
    assert.equal((await screenLinkedInCard(posting(1), options)).decision, 'fetch');
    await screenLinkedInCard(posting(1), options); assert.equal(calls, 1);
    probability = 0.95;
    assert.equal((await screenLinkedInCard({ ...posting(1), location: 'New evidence' }, options)).decision, 'skip');
    assert.equal(calls, 2);
  });
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
await test('published screening edits change search limits, retry pacing, Jev decisions and admission', async () => {
  const doc = initialSettingsDocument();
  doc.linkedinScreening = { policyVersion: 1, resultsPerSearch: 2, mismatchProbability: 0.99,
    instructions: 'Published preliminary policy', investigateCriteria: 'Plausibly relevant.', mismatchCriteria: 'Clear mismatch.',
    requestMinSeconds: 45, requestMaxSeconds: 45, requestTimeoutSeconds: 25,
    retry: { ...doc.linkedinScreening.retry, minTimeoutInMs: 120000 } };
  doc.ingestMinimumScore = 70;
  await withSettingsSnapshot(settingsFromDocument(doc), async () => {
    const html = [1,2,3].map(id => card.replace('jobPosting:123', `jobPosting:${id}`)).join('');
    const found = await searchLinkedIn({window:linkedinWindow(null), searches:[{keywords:'one'}],
      sleep:async()=>{},fetchImpl:async()=>new Response(html)});
    assert.equal(found.jobs.length, 2);
    const cache=new Map();
    const options={load:async(_,key)=>cache.get(key),save:async(_,key,value)=>{cache.set(key,value);return value;},
      evaluate:async({questions})=>{
        const [key]=Object.keys(questions);
        assert.match(questions[key].instructions,/Published preliminary policy/);
        return {answers:{[key]:{choice:'mismatch',probabilities:{mismatch:0.95,investigate:0.05}}}};
      }};
    const result = await screenLinkedInCard(posting(9), options);
    assert.equal(result.decision,'fetch');
    const lower=structuredClone(doc);lower.linkedinScreening.mismatchProbability=0.9;
    const changed=await withSettingsSnapshot(settingsFromDocument(lower),()=>screenLinkedInCard(posting(9),options));
    assert.equal(changed.decision,'skip');assert.notEqual(changed.fingerprint,result.fingerprint);
    const report=await discoverLinkedIn({...base,search:async()=>({jobs:[posting(1)],scans:[],complete:true}),
      ingest:async(_,options)=>{assert.equal(options.minimumScore,70);return {screeningRows:[],addedRows:[{id:'saved'}]};},
      read:async()=>({jevAssessment:{status:'complete',score:65},overviewSummary:{position:'Role',fit:'Fit'}})});
    assert.equal(report.complete,false,'saved job must meet the published minimum');
  });
});
await test('Trigger owns request timeout and retries', async () => {
  const signal = new AbortController().signal;
  const result = await fetchLinkedInPage({url:'https://www.linkedin.com/jobs/search/',policy:DEFAULT_LINKEDIN_SETTINGS}, {
    signal, fetchRequest:async (_, options) => {
      assert.equal(options.signal,signal); assert.equal(options.timeoutInMs,25000);
      assert.deepEqual(options.retry,{byStatus:{},timeout:{maxAttempts:1},connectionError:{maxAttempts:1}});
      return new Response('public results');
    }});
  assert.deepEqual(result,{status:200,body:'public results'});
});
await test('Retry-After maps seconds and dates into native retryAt', async () => {
  assert.equal(retryAfterDate('120',0).getTime(),120000);
  assert.equal(retryAfterDate('Thu, 01 Oct 2026 12:00:00 GMT',0).toISOString(),'2026-10-01T12:00:00.000Z');
  assert.equal(retryAfterDate('invalid'),undefined);
  assert.equal(retryAfterDate('0'),undefined);
  await assert.rejects(fetchLinkedInPage({url:'https://www.linkedin.com/jobs/search/',policy:DEFAULT_LINKEDIN_SETTINGS}, {
    fetchRequest:async()=>new Response('',{status:429,headers:{'retry-after':'600'}})
  }),error=> {
    const native=linkedInRetryPolicy({payload:{policy:DEFAULT_LINKEDIN_SETTINGS},error});
    assert.deepEqual(native.retry,DEFAULT_LINKEDIN_SETTINGS.retry);
    assert.ok(native.retryAt.getTime()>Date.now()+590000);return true;
  });
});
await test('real retry.fetch returns throttles promptly and keeps Trigger as the retry owner', async () => {
  let calls = 0, route = '/429-empty';
  const server = createServer((request, response) => {
    calls++;
    response.statusCode = request.url === '/forbidden' ? 403 : 429;
    response.setHeader('retry-after', '600');
    if (request.url === '/429-empty') response.setHeader('content-length', '0');
    response.end(request.url === '/429-empty' ? undefined : 'busy');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const realFetch = (url, options) => {
      assert.equal(url, 'https://www.linkedin.com/jobs/search/');
      assert.deepEqual(options.retry, {byStatus:{},timeout:{maxAttempts:1},connectionError:{maxAttempts:1}});
      return retry.fetch(`${origin}${route}`, options);
    };
    const call = async path => {
      route = path;
      let timeout;
      const outcome = await Promise.race([
        fetchLinkedInPage({url:'https://www.linkedin.com/jobs/search/',policy:DEFAULT_LINKEDIN_SETTINGS}, {
          fetchRequest:realFetch,
        }).then(value => ({value}), error => ({error})),
        new Promise(resolve => { timeout = setTimeout(() => resolve({timeout:true}), 1500); }),
      ]);
      clearTimeout(timeout);
      assert.equal(outcome.timeout, undefined, `${path} response cleanup must not delay the request result`);
      return outcome;
    };

    for (const path of ['/429-empty', '/429-body']) {
      calls = 0;
      const {error} = await call(path);
      assert.equal(calls, 1, 'retry.fetch performs one request per child-task attempt');
      assert.ok(error?.retryAt instanceof Date);
      const native = linkedInRetryPolicy({payload:{policy:DEFAULT_LINKEDIN_SETTINGS},error,
        ctx:{attempt:{number:1}}});
      assert.deepEqual(native.retry, DEFAULT_LINKEDIN_SETTINGS.retry);
      assert.ok(native.retryAt.getTime() > Date.now() + 590000);
      const exhausted = linkedInRetryPolicy({payload:{policy:DEFAULT_LINKEDIN_SETTINGS},error,
        ctx:{attempt:{number:DEFAULT_LINKEDIN_SETTINGS.retry.maxAttempts}}});
      assert.deepEqual(exhausted, {skipRetrying:true});
    }

    calls = 0;
    const forbidden = await call('/forbidden');
    assert.equal(calls, 1);
    assert.equal(linkedInRetryPolicy({payload:{policy:DEFAULT_LINKEDIN_SETTINGS},error:forbidden.error}).skipRetrying, true);
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
});
await test('unsafe endpoints and auth abort; expired postings do not retry', async () => {
  for (const url of ['https://evil.example/jobs/search/','https://www.linkedin.com/private']) {
    await assert.rejects(fetchLinkedInPage({url,policy:DEFAULT_LINKEDIN_SETTINGS},{fetchRequest:async()=>assert.fail('unsafe')}),
      error=>linkedInRetryPolicy({payload:{},error}).skipRetrying===true);
  }
  for (const status of [302,401,403,999]) {
    await assert.rejects(fetchLinkedInPage({url:'https://www.linkedin.com/jobs/search/',policy:DEFAULT_LINKEDIN_SETTINGS},{
      fetchRequest:async()=>({ok:false,status,headers:new Headers(),body:null})
    }),error=>linkedInRetryPolicy({payload:{},error}).skipRetrying===true);
  }
  assert.equal((await fetchLinkedInPage({url:'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/123',policy:DEFAULT_LINKEDIN_SETTINGS},{
    fetchRequest:async()=>new Response('',{status:404})
  })).status,404);
});
await test('ownership survives waits; only terminal owners can be replaced atomically', async () => {
  let owner='run_old',completed=false;
  const client={set:async(_,value)=>{if(owner)return null;owner=value;return 'OK';},get:async()=>owner,
    eval:async(_,keys,[expected,next])=>{if(owner!==expected)return 0;owner=next;return 1;}};
  assert.equal(await claimLinkedInSource(client,'run_new',async()=>({isCompleted:completed})),false);
  completed=true;
  assert.equal(await claimLinkedInSource(client,'run_new',async()=>({isCompleted:completed})),true);
  assert.equal(owner,'run_new');
  await assert.rejects(claimLinkedInSource(client,'run_other',async()=>{throw Error('status unavailable');}));
  assert.equal(owner,'run_new');
  assert.equal(await claimLinkedInSource(client,'run_race',async()=>{owner='another';return {isCompleted:true};}),false);
});
console.log(`passed ${passed}, failed ${failed}`);
process.exitCode = failed ? 1 : 0;
