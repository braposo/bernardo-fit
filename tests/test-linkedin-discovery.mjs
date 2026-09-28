import assert from 'node:assert/strict';
import { londonSchedule, dispatchLinkedIn } from '../functions/discover-linkedin/schedule.js';
import { parseLinkedInResults, linkedinWindow, searchLinkedIn, linkedinOpportunity } from '../lib/linkedin-source.js';
import { discoverLinkedIn } from '../lib/linkedin-discovery.js';
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
const base = {sleep:async()=>{}, list:async()=>[], describe:async p=>({...p,externalId:`linkedin-${p.id}`,jobDescription:'Full description'})};
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
console.log(`passed ${passed}, failed ${failed}`);
process.exitCode = failed ? 1 : 0;
