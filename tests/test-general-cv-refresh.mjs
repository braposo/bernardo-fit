import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {executeGeneralCvRefresh,generalCvFingerprint,generalCvPageAvailable,getGeneralCvAvailability,planGeneralCvRefresh,
  GENERAL_CV_PUBLIC_URL} from '../lib/general-cv-refresh.js';
import {refreshGeneralCv} from '../scripts/refresh-general-cv.mjs';

const source={identity:{name:'Synthetic Candidate',headline:'Engineer',contacts:[]},
  roles:[{id:'role-one',title:'Engineer',company:'Acme',dates:'2020–2024',overviewEvidenceId:'evidence-one',
    generalEvidenceIds:[],evidence:[{id:'evidence-one',text:'Built an accessible portal.',sourceRef:{documentId:'source-one',revision:'source-rev',passage:'I built an accessible portal.'},contribution:'personal',status:'delivered',skills:[]}]}],
  education:[],projects:[],settings:{minBodyPx:13,maxWords:600},
  revisions:{identity:'page-rev',settings:'settings-rev',records:['role-one:role-rev','evidence-one:evidence-rev']}};
assert.equal(generalCvFingerprint(source),generalCvFingerprint({...source,revisions:{...source.revisions,identity:'new-rev'},
  roles:[{...source.roles[0],evidence:[{...source.roles[0].evidence[0],sourceRef:{...source.roles[0].evidence[0].sourceRef,revision:'new-source-rev'}}]}]}));
assert.notEqual(generalCvFingerprint(source),generalCvFingerprint({...source,roles:[{...source.roles[0],generalEvidenceIds:['evidence-two']}]}));

const pdf=Buffer.from('%PDF-1.7\nsynthetic general CV\n%%EOF');
const pdfSha256=createHash('sha256').update(pdf).digest('hex');
const content={variant:'general',publicUrl:GENERAL_CV_PUBLIC_URL,identity:source.identity,
  experience:[{title:'Engineer',company:'Acme',dates:'2020–2024',bullets:[{text:'Built an accessible portal.'}]}],education:[],projects:[]};
let page={_id:'page-cv',_rev:'page-rev',cv:{name:'Synthetic Candidate'},
  download:{_type:'file',asset:{_type:'reference',_ref:'old-asset'}},
  downloadUrl:'https://cdn.sanity.io/files/quli96gc/production/old.pdf'};
let sourceState=structuredClone(source),drafts=0,uploads=0,renders=0,guarded=[];
const client={
  withConfig(){return this;},
  async fetch(query){
    if(query.includes('_type == "sitePage"'))return structuredClone(page);
    if(query.includes('count(*[_id in $ids])'))return drafts;
    throw Error('Unexpected query');
  },
  assets:{async upload(_type,bytes){uploads++;assert.deepEqual(Buffer.from(bytes),pdf);return {_id:'new-asset'};}},
  transaction(){let fields;
    return {patch(id,build){build({ifRevisionId(rev){guarded.push([id,rev]);return {
      set(next){fields=next;return this;}};}});return this;},
      async commit(){assert.ok(guarded.some(([id,rev])=>id==='page-cv'&&rev===page._rev));
        page={...page,...fields,_rev:'published-rev',downloadUrl:'https://cdn.sanity.io/files/quli96gc/production/new.pdf'};
        sourceState.revisions.identity=page._rev;return {};}};
  },
};
const loadSource=async()=>structuredClone(sourceState);
const build=()=>({content,requirementMap:[]});
const render=async()=>{renders++;return {pdfBytes:pdf,pdfSha256,layout:{pageCount:1}};};
const deps={client,loadSource,build,render};
assert.deepEqual(await getGeneralCvAvailability(client),{available:false,url:''});
const plan=await planGeneralCvRefresh({client,loadSource});
assert.equal(plan.needed,true);
const published=await executeGeneralCvRefresh({expectedSourceFingerprint:plan.sourceFingerprint,runId:'run-one'},deps);
assert.equal(published.outcome,'published');assert.equal(uploads,1);assert.equal(renders,1);
assert.equal(page.download.asset._ref,'new-asset');assert.equal(page.generalCv.pdfAssetId,'new-asset');
assert.equal(page.generalCv.pdfSha256,pdfSha256);
assert.equal(page.generalCv.usage.payload.includes('"estimatedAiCostMicros":0'),true);
assert.ok(guarded.some(([id,rev])=>id==='source-one'&&rev==='source-rev'));
assert.deepEqual(await getGeneralCvAvailability(client),{available:true,url:'/bernardo-raposo-cv.pdf'});
assert.equal(generalCvPageAvailable({...page,download:{asset:{_ref:'other-asset'}}}),false);
assert.equal(generalCvPageAvailable({...page,generalCv:{...page.generalCv,
  content:{payload:JSON.stringify({...content,publicUrl:'javascript:alert(1)'})}}}),false);
assert.equal(generalCvPageAvailable({...page,generalCv:{...page.generalCv,
  content:{payload:JSON.stringify({...content,experience:[]})}}}),false);
assert.equal((await planGeneralCvRefresh({client,loadSource})).needed,false);
assert.equal((await executeGeneralCvRefresh({expectedSourceFingerprint:plan.sourceFingerprint,runId:'run-two'},deps)).outcome,'reused');
assert.equal(uploads,1);assert.equal(renders,1);

page={...page,generalCv:undefined,_rev:'changed-rev'};sourceState.revisions.identity=page._rev;
drafts=1;
await assert.rejects(executeGeneralCvRefresh({expectedSourceFingerprint:plan.sourceFingerprint},deps),{code:'GENERAL_CV_DRAFT_EXISTS'});
assert.equal(page.download.asset._ref,'new-asset');assert.equal(uploads,1);
drafts=0;
await assert.rejects(executeGeneralCvRefresh({expectedSourceFingerprint:plan.sourceFingerprint},
  {...deps,render:async()=>{throw Error('Renderer failed');}}),/Renderer failed/);
assert.equal(page.download.asset._ref,'new-asset');assert.equal(uploads,1);

const dry=await refreshGeneralCv({plan:async()=>({needed:true,sourceFingerprint:'fingerprint',rendererVersion:'renderer',templateVersion:'template'})});
assert.equal(dry.triggered,false);
const priorKey=process.env.TRIGGER_SECRET_KEY,priorBranch=process.env.TRIGGER_PREVIEW_BRANCH;
try {
  process.env.TRIGGER_SECRET_KEY='tr_dev_test';
  let requested;
  const result=await refreshGeneralCv({apply:true,branch:'codex/personalised-cv',
    plan:async()=>({needed:true,sourceFingerprint:'fingerprint',rendererVersion:'renderer',templateVersion:'template'}),
    sdk:async()=>({idempotencyKeys:{create:async(key,options)=>{assert.equal(options.scope,'global');return key;}},
      tasks:{trigger:async(id,payload,options)=>{requested={id,payload,options};return {id:'trigger-run'};}},
      runs:{retrieve:async()=>({isCompleted:true,status:'COMPLETED',output:{outcome:'published',pdfSha256:'sha',aiCostMicros:0}})}})});
  assert.equal(result.runId,'trigger-run');assert.equal(result.outcome,'published');
  assert.equal(requested.id,'general-cv-refresh');assert.equal(requested.payload.publicUrl,GENERAL_CV_PUBLIC_URL);
  assert.match(requested.options.idempotencyKey,/fingerprint:template:renderer/);
  assert.equal(process.env.TRIGGER_PREVIEW_BRANCH,'codex/personalised-cv');
  let subscriptionSignal,readCount=0;
  const subscribed=await refreshGeneralCv({apply:true,branch:'codex/personalised-cv',
    plan:async()=>({needed:true,sourceFingerprint:'subscription-test',rendererVersion:'renderer',templateVersion:'template'}),
    sdk:async()=>({idempotencyKeys:{create:async key=>key},
      tasks:{trigger:async()=>({id:'subscribed-run'})},
      runs:{retrieve:async()=>{readCount++;return {isCompleted:false,status:'EXECUTING'};},
        subscribeToRun:(_id,{signal})=>{subscriptionSignal=signal;return (async function*(){
          yield {isCompleted:true,status:'COMPLETED',output:{outcome:'published',aiCostMicros:0}};
        })();}}})});
  assert.equal(subscribed.runId,'subscribed-run');assert.equal(readCount,1);
  assert.equal(subscriptionSignal.aborted,true);
} finally {
  if(priorKey===undefined)delete process.env.TRIGGER_SECRET_KEY;else process.env.TRIGGER_SECRET_KEY=priorKey;
  if(priorBranch===undefined)delete process.env.TRIGGER_PREVIEW_BRANCH;else process.env.TRIGGER_PREVIEW_BRANCH=priorBranch;
}
console.log('passed 1, failed 0');
