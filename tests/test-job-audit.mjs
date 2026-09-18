process.env.ADMIN_SECRET = "audit-secret";
import assert from "node:assert/strict";
import * as store from "../lib/store.js";
import { getJobAudit, jobMutationEvents } from "../lib/job-audit.js";
import { saveScreenArtifact } from "../lib/screen-artifacts.js";
import { recordUsage, readJobUsage } from "../lib/usage.js";
import { withGenerationContext } from "../lib/generation-context.js";
import handler from "../api/admin/jobs.js";
import track from "../api/track.js";
import { makeViewToken } from "../lib/admin.js";
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("  ok   " + name); } catch(e) { failed++; console.error("  FAIL " + name, e); } }
const res = () => ({ code:0, body:null, status(n){this.code=n;return this;}, json(b){this.body=b;return this;}, end(){return this;}, setHeader(){} });
const job = await store.saveJob({company:"Audit company",role:"Engineer",notes:"Private body",stage:"new"});
await test("creation and concurrent status/detail writes persist without lost events", async () => {
  await Promise.all([store.updateJob(job.id,{stage:"reviewing"}),store.updateJob(job.id,{notes:"Changed private body"})]);
  const events=(await getJobAudit(await store.getJob(job.id))).events;
  assert.equal(events.filter(e=>e.type==='job.created').length,1);
  assert.equal(events.filter(e=>e.type==='status.changed').length,1);
  assert.equal(events.filter(e=>e.type==='job.updated').length,1);
  assert.ok(!JSON.stringify(events).includes('Changed private body'));
  assert.ok(events.every((e,i)=>!i || Date.parse(events[i-1].at)>=Date.parse(e.at)));
});
await test("no-op changes and aborted mutations do not produce audit entries",async()=>{
  const before=(await getJobAudit(await store.getJob(job.id))).events.length;
  await store.updateJob(job.id,{stage:'reviewing'});
  await assert.rejects(store.mutateJob(job.id,()=>{throw new Error('abort');}));
  assert.equal((await getJobAudit(await store.getJob(job.id))).events.length,before);
});
await test("report generation, publication, views and downloads remain after relinking",async()=>{
  const id=await store.saveReport({created_at:new Date().toISOString(),job_description:'Audit JD',model:'gpt-5.6-sol'});
  await store.updateJob(job.id,{fitReportId:id});
  await store.trackEvent(id,'view'); await store.trackEvent(id,'cv_download'); await store.trackEvent(id,'copy_link');
  await store.addReportVersion(id,{created_at:new Date().toISOString(),job_description:'Audit JD two',model:'gpt-5.6-sol'},null,{vid:'v2'});
  await store.updateJob(job.id,{fitReportId:'another-report'});
  const events=(await getJobAudit(await store.getJob(job.id))).events;
  for (const type of ['document.generated','document.published','engagement.view','engagement.cv_download','engagement.copy_link']) assert.ok(events.some(e=>e.type===type),type);
});
await test("artifact retry does not duplicate generation events",async()=>{
  await saveScreenArtifact('research',job.id,'research-one',{model:'gpt-5.6-sol',at:'2026-09-18T00:00:00Z'});
  await saveScreenArtifact('research',job.id,'research-one',{model:'gpt-6-astra'});
  assert.equal((await getJobAudit(await store.getJob(job.id))).events.filter(e=>e.id==='research-research-one').length,1);
});
await test("pagination uses a snapshot and keeps a complete newest-first history",async()=>{
  const paged=await store.saveJob({company:'Paged'});
  for(let i=0;i<60;i++) await store.updateJob(paged.id,{notes:'Revision '+i});
  const current=await store.getJob(paged.id);
  const first=await getJobAudit(current,{limit:20});
  const second=await getJobAudit(current,{snapshot:first.snapshot,offset:20,limit:20});
  const third=await getJobAudit(current,{snapshot:first.snapshot,offset:40,limit:20});
  const last=await getJobAudit(current,{snapshot:first.snapshot,offset:60,limit:20});
  assert.equal(new Set([...first.events,...second.events,...third.events,...last.events].map(e=>e.id)).size,61);
  assert.ok(first.hasMore); assert.equal(last.hasMore,false);
});
await test("legacy history is explicit and never invents old status transitions",async()=>{
  const legacy={id:'legacy',createdAt:'2020-01-01T00:00:00Z',stage:'interviewing'};
  const history=await getJobAudit(legacy);
  assert.equal(history.events.length,1); assert.equal(Date.parse(history.events[0].at),Date.parse(legacy.createdAt)); assert.ok(history.historyNote);
});
await test("run and application-answer state transitions are recorded",async()=>{
  const before={stage:'new',questions:[{id:'q',q:'Question'}]};
  const after={...before,analysisRun:{status:'failed',requestId:'req',model:'m'},questions:[{id:'q',q:'Question',answeredAt:'now',model:'m'}]};
  const events=jobMutationEvents(before,after,2);
  assert.ok(events.some(e=>e.type==='generation.failed')); assert.ok(events.some(e=>e.type==='answer.generated'));
});
await test("job usage aggregates only its own calls and writes audit evidence",async()=>{
  await withGenerationContext({jobId:job.id},()=>recordUsage({kind:'analysis',model:'gpt-5.6-sol',usage:{input_tokens:100,output_tokens:50}}));
  await withGenerationContext({jobId:'different-job'},()=>recordUsage({kind:'cover',model:'gpt-6-astra',usage:{input_tokens:900,output_tokens:200}}));
  const usage=await readJobUsage(job.id);
  assert.equal(usage.days[0].calls,1); assert.equal(usage.days[0].input,100); assert.equal(usage.breakdown[0].model,'gpt-5.6-sol');
  assert.ok((await getJobAudit(await store.getJob(job.id))).events.some(e=>e.type==='ai.call'));
});
await test("public report usage follows the job when the report is linked",async()=>{
  await withGenerationContext({reportId:'public-audit-report'},()=>recordUsage({kind:'analysis',model:'gpt-5.6-sol',usage:{input_tokens:75,output_tokens:25}}));
  const usage=await readJobUsage('public-job',['public-audit-report','public-audit-report']);
  assert.equal(usage.days[0].calls,1); assert.equal(usage.days[0].input,75);
  const audit=await getJobAudit({id:'public-job',fitReportId:'public-audit-report',auditStartedAt:new Date().toISOString()});
  assert.ok(audit.events.some(e=>e.type==='ai.call'));
});
await test("activity API requires admin and never exposes other job usage",async()=>{
  let out=res(); await handler({method:'GET',headers:{},query:{id:job.id,activity:'1'}},out); assert.equal(out.code,401);
  out=res(); await handler({method:'GET',headers:{'x-admin-secret':'audit-secret'},query:{id:job.id,activity:'1'}},out);
  assert.equal(out.code,200); assert.equal(out.body.usage.days[0].calls,1); assert.ok(out.body.events.length);
});
await test("print events require a signed document token",async()=>{
  let out=res(); await track({method:'POST',body:{id:job.id,event:'document_print',kind:'cover',token:'bad'}},out); assert.equal(out.code,400);
  out=res(); await track({method:'POST',body:{id:job.id,event:'document_print',kind:'cover',token:makeViewToken(job.id)}},out); assert.equal(out.code,204);
  assert.equal((await getJobAudit(await store.getJob(job.id))).events.filter(e=>e.type==='document.print').length,1);
});
console.log(`passed ${passed}, failed ${failed}`); process.exitCode=failed?1:0;
