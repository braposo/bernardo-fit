import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import handler from '../api/admin/cv.js';
import {settleRun} from '../api/admin/cover.js';
import {saveJob} from '../lib/store.js';
import {createMemoryApplicationCvStore,withApplicationCvStore} from '../lib/application-cv-store.js';
import {applicationCvFields} from '../lib/application-cv-view.js';
import {applicationCvJobFingerprint} from '../lib/application-cv-fingerprint.js';

process.env.ADMIN_SECRET='cv-admin-test';
let passed=0,failed=0;
const test=async(name,fn)=>{try{await fn();passed++;console.log('  ok   '+name);}catch(error){failed++;console.error('  FAIL '+name+'\n'+error.stack);}};
const response=()=>({code:0,headers:{},body:null,setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;},end(){return this;}});
async function call({method='GET',query={},body={},authorised=true}={}){
  const res=response();await handler({method,query,body,headers:authorised?{'x-admin-secret':'cv-admin-test'}:{}},res);return res;
}
const cvStore=createMemoryApplicationCvStore();
await withApplicationCvStore(cvStore,async()=>{
  const job=await saveJob({company:'Synthetic',role:'Engineering Manager',jobDescription:'Build dependable software and coach product engineers.'});
  const app=await cvStore.claimApplicationCvRun(job,{requestId:'version-one',fingerprint:'fp-one',status:'running',runId:'run-one'});
  const pdfBuffer=Buffer.from('%PDF-1.7\nsynthetic validated PDF\n%%EOF');
  const version={id:'version-one',fingerprint:'fp-one',jobFingerprint:applicationCvJobFingerprint(job),
    createdAt:'2026-10-06T00:00:00Z',sourceSnapshot:{settings:{minBodyPx:13}},
    reportSnapshot:{report:{company:'Synthetic',job_title:'Engineering Manager'}},
    content:{identity:{name:'Synthetic Candidate',headline:'Engineering leader',contacts:[]},summary:'Evidence based experience.',
      experience:[{title:'Engineer',company:'Previous company',dates:'2020–2024',bullets:[{text:'Built accessible interfaces.',evidenceIds:['private-source']}]}],
      fitUrl:`https://fit.example/fit/${app.publicId}`},
    validation:{status:'valid',issues:[]},pdfBuffer,pdfSha256:createHash('sha256').update(pdfBuffer).digest('hex'),
    pdfUrl:'https://cdn.sanity.io/files/quli96gc/production/synthetic.pdf'};
  await cvStore.saveApplicationCvVersion(job.id,version);
  await cvStore.publishApplicationCvVersion(job.id,version.id,{expectedRequestId:version.id,expectedFingerprint:version.fingerprint});
  await test('private version API requires admin authentication',async()=>{
    const res=await call({query:{id:job.id,version:version.id},authorised:false});assert.equal(res.code,401);
  });
  let urls;
  await test('view token opens a saved preview and download with private cache headers',async()=>{
    const issued=await call({method:'POST',body:{id:job.id,versionId:version.id,action:'view-token'}});
    assert.equal(issued.code,200);urls=issued.body;
    const preview=await call({query:Object.fromEntries(new URL(urls.previewUrl,'https://local').searchParams),authorised:false});
    assert.equal(preview.code,200);assert.match(preview.body,/Synthetic Candidate/);assert.doesNotMatch(preview.body,/private-source/);
    assert.equal(preview.headers['Cache-Control'],'private, no-store');assert.match(preview.headers['Content-Security-Policy'],/frame-ancestors 'self'/);
    const download=await call({query:Object.fromEntries(new URL(urls.downloadUrl,'https://local').searchParams),authorised:false});
    assert.equal(download.code,302);assert.match(download.headers.Location,/synthetic\.pdf\?dl=/);
  });
  await test('signed preview is scoped to a single job, version, and read action',async()=>{
    const query=Object.fromEntries(new URL(urls.previewUrl,'https://local').searchParams);
    for(const patch of [{id:'another-job'},{version:'another-version'},{action:'list'}]){
      assert.equal((await call({query:{...query,...patch},authorised:false})).code,401);
    }
    assert.equal((await call({method:'POST',query,body:{id:job.id,versionId:version.id,action:'publish'},authorised:false})).code,401);
  });
  await test('versions cannot be fetched through a different job',async()=>{
    const other=await saveJob({company:'Other',role:'Engineer'});
    assert.equal((await call({query:{id:other.id,version:version.id}})).code,404);
  });
  await test('historical publish succeeds after submission without changing submitted pin',async()=>{
    await cvStore.markApplicationCvSubmitted(job.id);
    await cvStore.claimApplicationCvRun(job,{requestId:'version-two',fingerprint:'fp-two',status:'running',runId:'run-two'});
    await cvStore.saveApplicationCvVersion(job.id,{...version,id:'version-two',fingerprint:'fp-two'});
    await cvStore.updateApplicationCvRun(job.id,'version-two',{status:'completed',publication:'saved'});
    const res=await call({method:'POST',body:{id:job.id,versionId:'version-two',action:'publish'}});
    assert.equal(res.code,200);assert.equal(res.body.job.applicationCv.currentVersionId,'version-two');
    assert.equal(res.body.job.applicationCv.submittedVersionId,'version-one');
  });
  await test('terminal Trigger failures settle a running CV so retry is possible',async()=>{
    await cvStore.claimApplicationCvRun(job,{requestId:'version-three',fingerprint:'fp-three',status:'running',runId:'run-three'});
    await settleRun({jobId:job.id,requestId:'version-three',runId:'run-three'},{applicationCv:true},{status:'FAILED',error:{message:'Renderer unavailable'}});
    const saved=await cvStore.getApplicationCv(job.id);assert.equal(saved.run.status,'failed');assert.equal(saved.run.error,'Renderer unavailable');
  });
  await test('stale inputs and latest validation status are visible without hiding published CV',async()=>{
    const state=await cvStore.getApplicationCv(job.id);
    state.run={status:'needs_review',validation:{status:'needs_review',issues:[{code:'METRIC',message:'Unsupported claim'}]}};
    const fields=applicationCvFields({...job,jobDescription:'Changed requirements'},state);
    assert.equal(fields.hasCv,true);assert.equal(fields.applicationCv.stale,true);
    assert.equal(fields.applicationCv.validationStatus,'needs_review');assert.equal(fields.applicationCv.validationSummary.issues.length,1);
  });
});
console.log(`passed ${passed}, failed ${failed}`);process.exitCode=failed?1:0;
