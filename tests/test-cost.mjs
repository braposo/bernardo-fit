import assert from 'node:assert/strict';
import { runAnswer, buildAnswerPrompt } from '../lib/answer.js';
import { answerPolicy } from '../lib/answer-policy.js';
import { buildSystemPrompt, PROFILE_CONTEXT } from '../lib/profile.js';
import { buildCoverPrompt, runCoverLetter } from '../lib/cover.js';
import { complete, systemBlocksFor } from '../lib/anthropic.js';
import { briefFingerprint, answerFingerprint } from '../lib/generation-fingerprint.js';
import { briefModelInput } from '../lib/brief-inputs.js';
import { withGenerationContext } from '../lib/generation-context.js';
import { recordUsage, readUsage, recentBreakdowns, dailyRollup, estimateCostMicros } from '../lib/usage.js';
import { summariseUsage } from '../public/admin-usage.js';
import * as store from '../lib/store.js';
import jobsHandler from '../api/admin/jobs.js';
import dispatchHandler, { claimRun } from '../api/admin/cover.js';
import { tasks, runs, idempotencyKeys } from '@trigger.dev/sdk';
import { runResearch } from '../lib/research.js';
import { executeAnswerWork } from '../lib/answer-work.js';

process.env.ANTHROPIC_API_KEY = 'mock'; process.env.ADMIN_SECRET = 'mock-admin';
delete process.env.AI_CACHE_TTL;
let pass = 0, fail = 0;
async function test(name, fn) { try { await fn(); pass++; console.log('  ok   '+name); } catch(e) { fail++; console.log('  FAIL '+name+' '+e.stack); } }
const opus='claude-opus-5', sonnet='claude-sonnet-5';
const reply = (text, extra={}) => ({ok:true,status:200,json:async()=>({content:[{type:'text',text}],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:5},...extra})});
let calls=[];
const mock = () => { calls=[]; globalThis.fetch=async(_url,opts)=>{calls.push(JSON.parse(opts.body));return reply('I build useful systems.');}; };
const report={company:'Acme',job_title:'Engineering Manager',pitch:'I build platforms.',job_description:'Remote UK engineering role',categories:[],differentiators:[]};

await test('confirmed UK fact uses no provider and records a saved call',async()=>{
 mock(); const result=await runAnswer({question:'Do you have the right to work in the UK?',economy:true,ref:'fact'});
 assert.equal(calls.length,0); assert.equal(result.source,'profile'); assert.match(result.answer,/UK Settled Status/);
 const usage=(await readUsage('fact'))[0]; assert.equal(usage.estimatedCostMicros,0); assert.equal(usage.model,'');
});
await test('country ambiguity, compound questions and personal unknowns are never shortcuts',()=>{
 for(const question of ['Do you need sponsorship?','Do you have the right to work in the US?','Do you have the right to work in the UK and US?','Where are you based and can you relocate?','What is your notice period?','What salary do you expect?','What is your start date?','Will you need sponsorship in the future?']) {
  assert.equal(answerPolicy({question,economy:true}).fact,'',question);
 }
});
await test('custom instructions disable the factual shortcut',async()=>{
 mock(); await runAnswer({question:'Where are you based?',model:opus,economy:true,instructions:'I have moved to Leeds.',ref:'steered'});
 assert.equal(calls.length,1); assert.match(calls[0].system.map(b=>b.text).join(''),/moved to Leeds/);
});
await test('economy motivation uses Sonnet medium and less than one quarter of fixed context',async()=>{
 mock(); await runAnswer({question:'Why this role?',report,economy:true,model:opus});
 assert.equal(calls[0].model,sonnet); assert.equal(calls[0].output_config.effort,'medium');
 const full=buildAnswerPrompt({question:'Why this role?',report});
 const compact=buildAnswerPrompt({question:'Why this role?',report,compact:true});
 assert.ok(compact.stable.length < full.stable.length / 4);
});
await test('economy falls back to full evidence for a nuanced question',async()=>{
 mock(); await runAnswer({question:'Describe your most difficult architecture tradeoff.',report,economy:true,model:opus});
 assert.equal(calls[0].model,opus); assert.equal(calls[0].output_config.effort,'high');
 assert.ok(calls[0].system.map(b=>b.text).join('').includes(PROFILE_CONTEXT));
});
await test('economy off preserves explicit model even for a routine question',async()=>{
 mock(); await runAnswer({question:'Why this role?',report,model:opus,economy:false});
 assert.equal(calls[0].model,opus);
});
await test('missing fit evidence prevents the compact model route',()=>{
 assert.equal(answerPolicy({question:'Why this role?',economy:true,model:opus}).compact,false);
});
await test('all full-profile writers share an identical first cache block without duplicating facts',()=>{
 const prompts=[buildSystemPrompt(),buildCoverPrompt({report}),buildAnswerPrompt({question:'A detailed question',report})];
 const blocks=prompts.map(systemBlocksFor);
 assert.equal(blocks[0][0].text,blocks[1][0].text); assert.equal(blocks[1][0].text,blocks[2][0].text);
 for(const prompt of prompts) assert.equal(prompt.stable.split(PROFILE_CONTEXT).length,2);
});
await test('answer job context is cached before changing previous answers and question',()=>{
 const a=systemBlocksFor(buildAnswerPrompt({question:'Why us?',report,previous:[]}));
 const b=systemBlocksFor(buildAnswerPrompt({question:'Tell us about a failure',report,previous:[{q:'Why us?',a:'An earlier answer'}]}));
 assert.equal(a[2].text,b[2].text); assert.ok(a[2].cache_control); assert.notEqual(a[3].text,b[3].text); assert.equal(a[3].cache_control,undefined);
});
await test('one-hour caching is opt-in and applies consistently to all cached prefixes',()=>{
 process.env.AI_CACHE_TTL='1h'; const blocks=systemBlocksFor(buildAnswerPrompt({question:'Why us?',report}));
 assert.ok(blocks.filter(b=>b.cache_control).every(b=>b.cache_control.ttl==='1h'));
 delete process.env.AI_CACHE_TTL; assert.equal(systemBlocksFor({stable:'rules'})[0].cache_control.ttl,undefined);
});
for(const status of [400,401,403,404,413,422,408,409,429,500,503]) await test('provider status '+status+' gets correct retry classification',async()=>{
 globalThis.fetch=async()=>({ok:false,status,text:async()=>'mock error'});
 let error; try{await complete({model:opus,system:{stable:'x'},messages:[{role:'user',content:'x'}],ref:'status'+status});}catch(e){error=e;}
 assert.equal(error.providerStatus,status); assert.equal(!!error.abort,status<500 && ![408,409,429].includes(status));
 assert.equal((await readUsage('status'+status))[0].httpStatus,status);
});
await test('search budget decreases across continuations and aborts without another paid call',async()=>{
 calls=[];globalThis.fetch=async(_url,opts)=>{calls.push(JSON.parse(opts.body));return reply('{}',{stop_reason:'pause_turn',usage:{server_tool_use:{web_search_requests:4}}});};
 await assert.rejects(complete({model:opus,system:{stable:'x'},messages:[{role:'user',content:'x'}],maxSearches:8,tools:[{name:'web_search',type:'web_search_20260318',max_uses:8}]}),e=>e.abort && e.code==='SEARCH_LIMIT');
 assert.equal(calls.length,2);assert.equal(calls[1].tools[0].max_uses,4);
});
await test('unrecoverable cover parsing stops after its own two attempts',async()=>{
 calls=[];globalThis.fetch=async(_url,opts)=>{calls.push(JSON.parse(opts.body));return reply('???');};
 await assert.rejects(runCoverLetter({report,model:opus}),e=>e.abort===true);assert.equal(calls.length,2);
});
await test('metadata-only changes leave brief input and fingerprint unchanged',()=>{
 const job={id:'a',fitReportId:'r',updatedAt:'today',questions:[{id:'q',q:'Location?',a:'Harrogate',answeredAt:'yesterday',run:{status:'queued'}}]};
 const changed=structuredClone(job);changed.updatedAt='later';changed.questions[0].run.status='completed';changed.questions[0].answeredAt='later';
 assert.deepEqual(briefModelInput(job,report,{}),briefModelInput(changed,report,{}));assert.equal(briefFingerprint(job,report,{}),briefFingerprint(changed,report,{}));
 changed.questions[0].a='Leeds';assert.notEqual(briefFingerprint(job,report,{}),briefFingerprint(changed,report,{}));
});
await test('economy choice participates in answer fingerprint',()=>{
 const job={id:'a',questions:[{id:'q',q:'Why us?'}]};assert.notEqual(answerFingerprint(job,'q',opus,report),answerFingerprint(job,'q',opus,report,{economy:true}));
});
await test('no-op PATCH preserves research and brief freshness, actual note edit invalidates brief',async()=>{
 const job=await store.saveJob({company:'Acme',role:'EM',notes:'Existing note',briefFingerprint:'brief-current',researchFingerprint:'research-current'});
 const invoke=async body=>{const res={status(c){this.code=c;return this},json(b){this.body=b;return this},setHeader(){}};await jobsHandler({method:'PATCH',query:{id:job.id},headers:{'x-admin-secret':'mock-admin'},body},res);assert.equal(res.code,200);return store.getJob(job.id);};
 let saved=await invoke({company:'Acme',notes:'Existing note'});assert.equal(saved.briefFingerprint,'brief-current');assert.equal(saved.researchFingerprint,'research-current');
 saved=await invoke({notes:'Changed note'});assert.equal(saved.briefFingerprint,'');assert.equal(saved.researchFingerprint,'research-current');
});
await test('no-op question edit keeps brief fresh',async()=>{
 const job=await store.saveJob({company:'Question',briefFingerprint:'fresh',questions:[{id:'q',q:'Location?',a:'Harrogate',limit:100}]});
 const saved=await store.editQuestion(job.id,{id:'q',q:'Location?',limit:100});assert.equal(saved.briefFingerprint,'fresh');
 const changed=await store.editQuestion(job.id,{id:'q',q:'New question'});assert.equal(changed.briefFingerprint,'');
});
await test('concurrent equivalent claims share a winner but explicit completed rewrites remain possible',async()=>{
 const job=await store.saveJob({company:'Concurrent'});const spec={field:'coverRun'};
 const pending=id=>({requestId:id,runId:'',model:opus,fingerprint:'same',status:'dispatching'});
 const results=await Promise.all([claimRun(job.id,spec,{},pending('request-a')),claimRun(job.id,spec,{},pending('request-b'))]);
 assert.equal(results[0].requestId,results[1].requestId);
 await store.mutateJob(job.id,current=>({coverRun:{...current.coverRun,status:'completed'}}));
 assert.equal((await claimRun(job.id,spec,{},pending('request-c'))).requestId,'request-c');
});
await test('facts complete through the durable answer worker and recover without more calls',async()=>{
 mock();const job=await store.saveJob({company:'Facts',questions:[{id:'q',q:'Where are you based?'}]});
 const fp=answerFingerprint(job,'q',opus,null,{economy:true});
 await store.mutateJob(job.id,current=>({questions:current.questions.map(q=>({...q,run:{requestId:'worker-fact',fingerprint:fp,status:'queued'}}))}));
 const payload={jobId:job.id,questionId:'q',model:opus,economy:true,requestId:'worker-fact',fingerprint:fp};
 const result=await executeAnswerWork(payload);assert.equal(result.outcome,'completed');assert.equal(result.source,'profile');assert.equal(calls.length,0);
 assert.match((await store.getJob(job.id)).questions[0].a,/Harrogate/);
 await executeAnswerWork(payload);assert.equal((await readUsage('worker-fact')).length,1);
});
await test('telemetry preserves mixed cache TTL rates and worker attribution',async()=>{
 const entry=await withGenerationContext({runId:'run-test',taskAttempt:2},()=>recordUsage({kind:'research',ref:'detailed',model:opus,effort:'medium',continuation:1,
 usage:{input_tokens:100,output_tokens:20,cache_read_input_tokens:1000,cache_creation_input_tokens:150,cache_creation:{ephemeral_5m_input_tokens:100,ephemeral_1h_input_tokens:50},server_tool_use:{web_search_requests:2}}}));
 assert.equal(entry.estimatedCostMicros,22625);assert.equal(entry.taskAttempt,2);assert.equal(entry.runId,'run-test');assert.equal(entry.continuation,1);
 assert.equal(estimateCostMicros({model:'unknown'}),null);
 const rows=await recentBreakdowns(1);assert.ok(rows.some(r=>r.model===opus && r.kind==='research' && r.effort==='medium' && r.estimatedCostMicros>=22625));
});
await test('OpenAI pricing preserves the long-prompt threshold and model-specific cache rates',()=>{
 for (const [model, inputRate, outputRate, cacheRate, writeRate] of [
  ['gpt-5.6-sol',4,20,0.4,5], ['gpt-6-astra',10,50,1,12.5],
 ]) {
  const entry={model,input:270000,cacheRead:1000,cacheWrite:1000,output:100,searches:1};
  assert.equal(estimateCostMicros(entry),Math.round(270000*inputRate+1000*cacheRate+1000*writeRate+100*outputRate+10000));
  entry.input++;
  assert.equal(estimateCostMicros(entry),Math.round(270001*inputRate*2+1000*cacheRate*(model==='gpt-5.6-sol'?1:2)+1000*writeRate*2+100*outputRate*1.5+10000));
 }
});
await test('parallel telemetry contexts cannot mix worker identities',async()=>{
 const entries=await Promise.all(['a','b'].map(runId=>withGenerationContext({runId},async()=>{await new Promise(r=>setImmediate(r));return recordUsage({ref:runId,model:opus,usage:{}});})));assert.deepEqual(entries.map(e=>e.runId),['a','b']);
});
await test('usage summary counts historical unpriced calls without inventing their cost',()=>{
 const result=summariseUsage({days:[{calls:10,input:100,cacheWrite:50,cacheRead:850,output:20},{calls:2,pricedCalls:2,estimatedCostMicros:50000}],breakdown:[{kind:'answer',model:'',source:'profile',savedCalls:3}]});
 assert.equal(result.calls,12);assert.equal(result.pricedCalls,2);assert.equal(result.estimatedUsd,0.05);assert.equal(result.savedCalls,3);assert.equal(result.cachePercent,85);
});

await test('cover retries cannot reset the two-generation allowance',async()=>{
 mock();for(let i=0;i<2;i++) await recordUsage({ref:'spent-cover',kind:'cover',model:opus,usage:{input_tokens:1,output_tokens:1}});
 await assert.rejects(runCoverLetter({report,model:opus,ref:'spent-cover'}),e=>e.abort===true);assert.equal(calls.length,0);
});
await test('research retries cannot reset the search budget',async()=>{
 mock();await recordUsage({ref:'spent-research',kind:'research',model:sonnet,usage:{server_tool_use:{web_search_requests:8}}});
 await assert.rejects(runResearch({job:{company:'Acme'},ref:'spent-research'}),e=>e.abort===true);assert.equal(calls.length,0);
});
await test('dispatch recovers the same claim after an ambiguous error and preserves fast completion',async()=>{
 const original={trigger:tasks.trigger,retrieve:runs.retrieve,key:idempotencyKeys.create};
 try {
  const keys=[];let failOnce=true;
  idempotencyKeys.create=async key=>key;
  tasks.trigger=async(_task,payload,options)=>{
   keys.push(options.idempotencyKey);
   if(failOnce){failOnce=false;throw Error('mock connection drop');}
   await store.mutateJob(payload.jobId,current=>({analysisRun:{...current.analysisRun,status:'completed'}}));
   return {id:'mock-fast-run'};
  };
  runs.retrieve=async()=>({status:'COMPLETED'});
  const job=await store.saveJob({company:'Dispatch',jobDescription:'A complete engineering leadership role description.'});
  const invoke=async requestId=>{const res={status(code){this.code=code;return this},json(body){this.body=body;return this},setHeader(){}};
   await dispatchHandler({method:'POST',headers:{'x-admin-secret':'mock-admin'},body:{id:job.id,kind:'analyse',model:opus,requestId}},res);return res;};
  assert.equal((await invoke('dispatch-first')).code,500);
  const second=await invoke('dispatch-retry');assert.equal(second.code,202);assert.equal(second.body.requestId,'dispatch-first');assert.equal(keys[0],keys[1]);
  assert.equal((await store.getJob(job.id)).analysisRun.status,'completed');
  assert.equal((await invoke('dispatch-first')).code,202);assert.equal(keys.length,2);
  assert.equal((await store.getJob(job.id)).analysisRun.status,'completed');
 } finally {tasks.trigger=original.trigger;runs.retrieve=original.retrieve;idempotencyKeys.create=original.key;}
});

console.log('\npassed '+pass+', failed '+fail);process.exit(fail?1:0);
