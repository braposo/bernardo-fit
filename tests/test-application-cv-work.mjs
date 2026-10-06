import assert from 'node:assert/strict';
import {tasks,idempotencyKeys} from '@trigger.dev/sdk';
import {saveJob,saveReport,updateJob,getReport} from '../lib/store.js';
import {publicReport} from '../lib/report.js';
import {withChildGenerationContext} from '../lib/generation-context.js';
import {withApplicationCvSource} from '../lib/application-cv-source.js';
import {createMemoryApplicationCvStore,withApplicationCvStore} from '../lib/application-cv-store.js';
import {applicationCvFingerprint} from '../lib/application-cv-fingerprint.js';
import {executeApplicationCvWork} from '../lib/application-cv-work.js';

const source={fingerprint:'source-test',identity:{name:'Synthetic Candidate',headline:'Engineer',contacts:[]},
  roles:[{id:'role-1',title:'Engineer',company:'Previous company',dates:'2020–2024',location:'London',
    evidence:[{id:'evidence-1',text:'Built an accessible customer portal.',contribution:'personal',status:'delivered',skills:[]}]}],
  education:[],projects:[],settings:{model:'gpt-5.6-sol',prompt:'Use confirmed evidence.',minBodyPx:13,maxWords:300}};
const selection={summary:'Engineer experienced in accessible customer interfaces.',summaryEvidenceIds:['evidence-1'],
  roles:[{id:'role-1',bullets:[{text:'Implemented an accessible portal for customers.',evidenceIds:['evidence-1']}]}],
  requirementMap:[{requirement:'Accessible interfaces',status:'direct',evidenceIds:['evidence-1']}]};
const originalTrigger=tasks.triggerAndWait,originalKey=idempotencyKeys.create;
let calls=0,verifierSafe=true;
const checkpoints=new Map();
idempotencyKeys.create=async key=>JSON.stringify(key);
tasks.triggerAndWait=async(id,payload,options)=>{
  assert.equal(id,'durable-model-call');
  if(!checkpoints.has(options.idempotencyKey)){
    calls++;
    checkpoints.set(options.idempotencyKey,{ok:true,output:payload.provider==='cv'?{selection}:
      {status:verifierSafe?'valid':'needs_review',issues:verifierSafe?[]:[{code:'UNSUPPORTED',message:'Unconfirmed wording'}]}});
  }
  return structuredClone(checkpoints.get(options.idempotencyKey));
};
let passed=0,failed=0;
const test=async(name,fn)=>{try{await fn();passed++;console.log('  ok   '+name);}catch(error){failed++;console.error('  FAIL '+name+'\n'+error.stack);}};
const store=createMemoryApplicationCvStore();
let rejectSave=false;
const adapter={...store,saveApplicationCvVersion:async(...args)=>{if(rejectSave){rejectSave=false;throw Error('Temporary persistence failure');}return store.saveApplicationCvVersion(...args);}};
await withApplicationCvStore(adapter,()=>withApplicationCvSource(source,async()=>{
  const reportId=await saveReport({job_title:'Engineer',company:'Synthetic',job_description:'Build accessible customer interfaces.'});
  const job=await saveJob({company:'Synthetic',role:'Engineer',stage:'reviewing',jobDescription:'Build accessible customer interfaces.',fitReportId:reportId});
  const reportSnapshot={id:reportId,report:publicReport(await getReport(reportId))};
  const payload=id=>({jobId:job.id,requestId:id,model:'gpt-5.6-sol',origin:'https://fit.example',sourceSnapshot:source,
    jobSnapshot:job,reportSnapshot,reportId,fingerprint:applicationCvFingerprint(job,source,reportSnapshot,'gpt-5.6-sol')});
  const run=p=>withChildGenerationContext({runId:'trigger-parent',jobId:job.id,requestId:p.requestId},()=>executeApplicationCvWork(p));
  await test('failed persistence retries reuse both paid child results and publish the saved pair',async()=>{
    const p=payload('request-first');await store.claimApplicationCvRun(job,{requestId:p.requestId,fingerprint:p.fingerprint,status:'queued'});
    rejectSave=true;await assert.rejects(run(p),/persistence/);assert.equal(calls,2);
    assert.equal((await run(p)).publication,'published');assert.equal(calls,2);
    const app=await store.getApplicationCv(job.id);assert.equal(app.currentVersionId,p.requestId);
    assert.equal((await run(p)).publication,'published');assert.equal(calls,2);
  });
  await test('a rejected factual check preserves the last public pair and resumes without new paid work',async()=>{
    verifierSafe=false;const p=payload('request-review');await store.claimApplicationCvRun(job,{requestId:p.requestId,fingerprint:p.fingerprint,status:'queued'});
    assert.equal((await run(p)).outcome,'needs_review');const after=calls;
    assert.equal((await store.getApplicationCv(job.id)).currentVersionId,'request-first');
    assert.equal((await run(p)).outcome,'needs_review');assert.equal(calls,after);
  });
  await test('new valid output after submission is saved privately and leaves the submitted version fixed',async()=>{
    verifierSafe=true;await store.markApplicationCvSubmitted(job.id);
    const p=payload('request-after-applied');await store.claimApplicationCvRun(job,{requestId:p.requestId,fingerprint:p.fingerprint,status:'queued'});
    assert.equal((await run(p)).publication,'saved');const app=await store.getApplicationCv(job.id);
    assert.equal(app.currentVersionId,'request-first');assert.equal(app.submittedVersionId,'request-first');
  });
  await test('changed job inputs supersede the old request before any model call',async()=>{
    const p=payload('request-stale');await store.claimApplicationCvRun(job,{requestId:p.requestId,fingerprint:p.fingerprint,status:'queued'});
    await updateJob(job.id,{jobDescription:'Different job requirements'});const before=calls;
    assert.equal((await run(p)).outcome,'superseded');assert.equal(calls,before);
  });
}));
tasks.triggerAndWait=originalTrigger;idempotencyKeys.create=originalKey;
console.log(`passed ${passed}, failed ${failed}`);process.exitCode=failed?1:0;
