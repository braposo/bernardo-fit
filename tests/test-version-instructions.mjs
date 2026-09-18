process.env.ADMIN_SECRET = 'instructions-test';
process.env.ANTHROPIC_API_KEY = 'fake-key';
import assert from 'node:assert/strict';
import * as store from '../lib/store.js';
import { resolveGenerationReview, assertReviewedScope } from '../lib/generation-review.js';
import { withVersionInstructions, normaliseVersionInstructions } from '../lib/version-instructions.js';
import { executeAnalysisWork } from '../lib/analysis-work.js';
import { executeCoverWork } from '../lib/cover-work.js';
import { executeResearchWork, executeBriefWork, researchIsReusable } from '../lib/screen-work.js';
import { briefFingerprint } from '../lib/generation-fingerprint.js';
import { getActiveResearch } from '../lib/screen-artifacts.js';
import { getActiveCoverArtifact } from '../lib/cover-artifacts.js';
import versionsHandler from '../api/admin/versions.js';

const requests = [];
globalThis.fetch = async (_url, options) => {
  requests.push(JSON.parse(options.body));
  return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
    job_title: 'Engineering Manager', company: 'Example', pitch: 'Public pitch', categories: [], differentiators: [], closing: 'Closing',
    internal: { score: 80, tier: 'Strong', breakdown: { location: 2, aiDx: 3, leadership: 4 }, reasoning: 'Reason' },
    salutation: 'Hello', paragraphs: [{ text: 'A relevant letter for this role.', lead: true }],
    summary: [{ text: 'Company summary', url: 'https://example.com/news' }], signals: [], risks: [], roleContext: [], unknowns: [],
    sources: [{ title: 'Company', url: 'https://example.com/news' }], contact: 'Recruiter', opening: 'My background', why: [],
    conversation: [], likelyQuestions: [], gapResponses: [], greenFlags: [], redFlags: [], questionsToAsk: [], companyReference: [], roleReference: [],
  }) }] }) };
};
let passed=0, failed=0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok   '+name); } catch(e) { failed++; console.error('  FAIL '+name, e); } }
const model='claude-sonnet-5', extra='Focus on infrastructure leadership <private>'; 
const job=await store.saveJob({ company:'Example',role:'EM',jobDescription:'A detailed engineering management job description.',instructions:'Keep the tone direct.',sourceUrl:'https://example.com/jobs' });
async function reviewed(kind, instructions=extra) {
  return resolveGenerationReview({kind,id:job.id,model,versionInstructions:instructions});
}
async function execute(kind, field, worker, requestId, instructions=extra) {
  const review=await reviewed(kind,instructions);
  await store.updateJob(job.id,{[field]:{requestId,fingerprint:review.workFingerprint,status:'queued',model}});
  return worker({jobId:job.id,requestId,fingerprint:review.workFingerprint,...review.payload});
}
await test('instructions are bounded and combined without mutating the job',()=>{
  assert.throws(()=>normaliseVersionInstructions('x'.repeat(4001)), /4000/);
  assert.throws(()=>normaliseVersionInstructions({text:'bad'}),/text/);
  const combined=withVersionInstructions(job,extra);
  assert.ok(combined.instructions.includes(job.instructions) && combined.instructions.includes(extra));
  assert.equal(job.instructions,'Keep the tone direct.');
  assert.equal(withVersionInstructions(combined,extra).instructions,combined.instructions);
});
await test('changed version instructions invalidate the review and propagate to task payload',async()=>{
  const first=await reviewed('analyse'); const changed=await reviewed('analyse','A different instruction');
  assert.notEqual(first.workFingerprint,changed.workFingerprint);
  assert.throws(()=>assertReviewedScope({kind:'analyse',reviewFingerprint:first.fingerprint},changed),/changed/);
  assert.equal(first.payload.versionInstructions,extra);
});
await test('analysis uses combined instructions and keeps metadata out of public report',async()=>{
  assert.equal((await execute('analyse','analysisRun',executeAnalysisWork,'instructions-analysis-1')).outcome,'completed');
  const saved=await store.getJob(job.id);const report=await store.getReport(saved.fitReportId);
  assert.ok(JSON.stringify(requests.at(-1)).includes(extra));
  assert.ok(JSON.stringify(requests.at(-1)).includes(job.instructions));
  assert.ok(!JSON.stringify(report).includes(extra));
  assert.equal((await store.listReportVersions(saved.fitReportId))[0].versionInstructions,extra);
  assert.equal(saved.instructions,job.instructions);
});
await test('regeneration stores its own instructions and preserves prior version metadata',async()=>{
  assert.equal((await execute('regenerate','analysisRun',executeAnalysisWork,'instructions-analysis-2','Emphasise developer tooling')).outcome,'completed');
  const list=await store.listReportVersions((await store.getJob(job.id)).fitReportId);
  assert.equal(list[0].versionInstructions,'Emphasise developer tooling');
  assert.equal(list[1].versionInstructions,extra);
});
await test('cover worker persists supplemental instructions and publishes automatically',async()=>{
  assert.equal((await execute('cover','coverRun',executeCoverWork,'instructions-cover-1')).outcome,'completed');
  const saved=await store.getJob(job.id);
  assert.equal((await getActiveCoverArtifact(saved)).versionInstructions,extra);
  assert.ok(JSON.stringify(requests.at(-1)).includes(extra));
  assert.equal(saved.instructions,job.instructions);
});
await test('research receives combined instructions and does not immediately become stale',async()=>{
  assert.equal((await execute('research','researchRun',executeResearchWork,'instructions-research-1')).outcome,'completed');
  const saved=await store.getJob(job.id), research=await getActiveResearch(saved);
  assert.equal(research.versionInstructions,extra);
  assert.ok(JSON.stringify(requests.at(-1)).includes(extra) && JSON.stringify(requests.at(-1)).includes(job.instructions));
  assert.ok(researchIsReusable(saved,research,Date.now(),model));
});
await test('brief worker uses and stores its own version instructions',async()=>{
  const saved=await store.getJob(job.id), research=await getActiveResearch(saved), report=await store.getReport(saved.fitReportId);
  const fingerprint=briefFingerprint(withVersionInstructions(saved,extra),report,research), requestId='instructions-brief-1';
  await store.updateJob(job.id,{briefRun:{requestId,fingerprint,status:'queued'}});
  assert.equal((await executeBriefWork({jobId:job.id,requestId,fingerprint,model,versionInstructions:extra})).outcome,'completed');
  assert.ok(JSON.stringify(requests.at(-1)).includes(extra));
  assert.equal((await store.getJob(job.id)).instructions,job.instructions);
});
await test('authenticated version listing exposes instructions for each document kind',async()=>{
  const res={status(code){this.code=code;return this},json(body){this.body=body;return this},setHeader(){}};
  await versionsHandler({method:'GET',headers:{'x-admin-secret':'instructions-test'},query:{id:job.id}},res);
  assert.equal(res.code,200);
  for(const kind of ['fit','letter','research','brief']) assert.ok(res.body[kind][0].versionInstructions);
});
await test('generic instruction changes supersede queued work rather than overwriting newer intent',async()=>{
  const review=await reviewed('cover');
  await store.updateJob(job.id,{coverRun:{requestId:'instructions-stale',fingerprint:review.workFingerprint,status:'queued'},instructions:'A changed generic instruction'});
  const before=requests.length;
  assert.equal((await executeCoverWork({jobId:job.id,requestId:'instructions-stale',fingerprint:review.workFingerprint,...review.payload})).outcome,'superseded');
  assert.equal(requests.length,before);
});
console.log(`\npassed ${passed}, failed ${failed}`);
process.exit(failed?1:0);
