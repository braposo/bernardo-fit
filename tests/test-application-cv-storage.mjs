import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {applicationCvSourceFromDocument} from '../lib/application-cv-source.js';
import {safeApplicationCvContactHref} from '../lib/application-cv-contacts.js';
import {createApplicationCvStore,createMemoryApplicationCvStore,publicCvVersion,applicationCvPdfUrl,withApplicationCvStore,getApplicationCv,getApplicationCvSummaries,getPublicApplicationCv} from '../lib/application-cv-store.js';
import {createApplicationHandler} from '../lib/handlers/application.js';
import {createSiteHandler} from '../api/site.js';
import {buildApplicationCvSeed,seedApplicationCv,DEFAULT_CV_VERIFIER_PROMPT,ROLE_OVERVIEW_EVIDENCE_KEYS} from '../scripts/seed-application-cv.mjs';
import {updateApplicationCvPrompts,PREVIOUS_CV_WRITER_PROMPT,PREVIOUS_CV_VERIFIER_PROMPT,
  V3_CV_WRITER_PROMPT,V3_CV_VERIFIER_PROMPT} from '../scripts/update-application-cv-prompts.mjs';
import {updateApplicationCvOverviews} from '../scripts/update-application-cv-overviews.mjs';
import {splitApplicationCvProjectsSpeaking} from '../scripts/split-application-cv-projects-speaking.mjs';
import {addApplicationCvPhone} from '../scripts/add-application-cv-phone.mjs';

const evidence={_id:'e1',_rev:'rev-e1',text:'Built the GraphQL service.',sourcePassage:'I built a GraphQL service.',
  source:{_id:'source-1',_rev:'rev-source'},contribution:'personal',status:'delivered',skills:['GraphQL']};
assert.equal(safeApplicationCvContactHref('TEL:+15550100123'),'tel:+15550100123');
assert.equal(safeApplicationCvContactHref('MAILTO:b@example.com'),'mailto:b@example.com');
for(const unsafe of ['tel:+15550100123;ext=9','tel:15550100123','tel:javascript:alert(1)',
  'javascript:alert(1)','https://user:pass@example.com','mailto:b@example.com?subject=private'])
  assert.equal(safeApplicationCvContactHref(unsafe),'');
const source={page:{_id:'page',_rev:'rev-page',cv:{name:'Bernardo Raposo',headline:'Engineer',contacts:[
  {label:'Email',href:'mailto:b@example.com'},{label:'+1 555 010 0123',href:'tel:+15550100123'},
  {label:'Unsafe phone',href:'tel:+15550100123;ext=9'}]}},
  settings:{_id:'application-cv-settings',_rev:'rev-settings',model:'gpt-5.6-sol',prompt:'Select evidence.',verifierPrompt:'Verify evidence.',maxWords:600,minBodyPx:13,layout:'classic'},
  roles:[{_id:'role-1',_rev:'rev-role',title:'Principal Engineer',company:'TravelRepublic',dates:'2018 – 2020',location:'London',overviewEvidenceId:'e1',evidence:[evidence]}],education:[],
  projects:[{_id:'project-1',_rev:'rev-project',title:'Fit',links:[{label:'View Fit',href:'https://fit.example/work'}],
    evidence:[{...evidence,_id:'project-evidence'}]}]};
const snapshot=applicationCvSourceFromDocument(source);
assert.equal(snapshot.roles[0].overviewEvidenceId,'e1');
assert.deepEqual(snapshot.identity.contacts,[{label:'Email',href:'mailto:b@example.com'},
  {label:'+1 555 010 0123',href:'tel:+15550100123'}]);
assert.equal(snapshot.roles[0].evidence[0].sourceRef.documentId,'source-1');
assert.equal(snapshot.roles[0].evidence[0].contribution,'personal');
assert.deepEqual(snapshot.projects[0].links,[{label:'View Fit',href:'https://fit.example/work'}]);
assert.throws(()=>applicationCvSourceFromDocument({...source,projects:[{...source.projects[0],links:[{label:'Unsafe',href:'javascript:alert(1)'}]}]}),/safe HTTP\(S\) URL/);
assert.notEqual(applicationCvSourceFromDocument({...source,settings:{...source.settings,_rev:'new-revision'}}).fingerprint,snapshot.fingerprint);
assert.throws(()=>applicationCvSourceFromDocument({...source,roles:[{...source.roles[0],evidence:[{...evidence,sourcePassage:''}]}]}),/incomplete/);
assert.throws(()=>applicationCvSourceFromDocument({...source,settings:{...source.settings,model:'unknown'}}),/Publish CV identity/);
assert.throws(()=>applicationCvSourceFromDocument({...source,settings:{...source.settings,verifierPrompt:''}}),/Publish CV identity/);
assert.throws(()=>applicationCvSourceFromDocument({...source,roles:[{...source.roles[0],overviewEvidenceId:'wrong'}]}),/overview fact/);
assert.throws(()=>applicationCvSourceFromDocument({...source,roles:[{...source.roles[0],evidence:[{...evidence,status:'proposed'}]}]}),/overview fact/);

let jobPresent=true;
const store=createMemoryApplicationCvStore({jobExists:()=>jobPresent});
assert.equal(await getApplicationCv('legacy-job'),null);
assert.deepEqual(await getApplicationCvSummaries(['legacy-job']),{});
const job={id:'job-1234'};
const first=await store.ensureApplicationCv(job);
assert.equal((await store.ensureApplicationCv(job)).publicId,first.publicId);
await withApplicationCvStore(store,async()=>assert.equal((await getApplicationCv(job.id)).publicId,first.publicId));
const pending={requestId:'request-1',fingerprint:'fp-1',status:'queued'};
assert.equal((await store.claimApplicationCvRun(job,pending)).run.requestId,pending.requestId);
assert.equal((await store.claimApplicationCvRun(job,{...pending,requestId:'other-identical'})).run.requestId,pending.requestId);
await assert.rejects(store.claimApplicationCvRun(job,{requestId:'request-2',fingerprint:'fp-2'}),{code:'APPLICATION_CV_BUSY'});
const pdf=Buffer.from('%PDF-1.7\nhello world\n%%EOF');
const pdfSha256=createHash('sha256').update(pdf).digest('hex');
const privateVersion={id:'request-1',createdAt:'2026-10-06T00:00:00Z',fingerprint:'fp-1',sourceFingerprint:snapshot.fingerprint,
  jobFingerprint:'jd-1',sourceSnapshot:snapshot,reportSnapshot:{id:'shared-report',report:{job_title:'Engineering Manager',company:'Acme',pitch:'A strong fit.',secret:'never public'}},
  content:{identity:snapshot.identity,summary:'A tailored summary.',experience:[{roleId:'role-1',title:'Principal Engineer',company:'TravelRepublic',dates:'2018 – 2020',bullets:[{text:'Built the GraphQL service.',evidenceIds:['e1']}]}],
    projects:[{title:'Fit',links:[{label:'View Fit',href:'https://fit.example/work'}],bullets:[{text:'Built my job-search application.',evidenceIds:['fit-evidence']}]},
      {title:'Open source — figma-graphql',links:[{label:'Unsafe',href:'javascript:alert(1)'}],bullets:[{text:'A GraphQL wrapper for the Figma API.',evidenceIds:['figma-evidence']}]},
      {title:'Speaking — React Advanced London',bullets:[{text:'Speaker at React Advanced London.',evidenceIds:['talk-evidence']}]}]},
  validation:{status:'valid',requirementMap:[{requirement:'GraphQL',sourceIds:['e1']}]},model:'test-model',pdfBuffer:pdf,pdfSha256};
const saved=await store.saveApplicationCvVersion(job.id,privateVersion);
assert.equal(saved.pdfSha256,pdfSha256);
assert.equal(saved.pdfBuffer,undefined);
assert.equal((await store.saveApplicationCvVersion(job.id,privateVersion)).id,saved.id);
assert.equal((await Promise.all([store.saveApplicationCvVersion(job.id,privateVersion),store.saveApplicationCvVersion(job.id,privateVersion)])).length,2);
assert.equal((await store.listApplicationCvVersions(job.id)).length,1);
await assert.rejects(store.publishApplicationCvVersion(job.id,saved.id,{expectedRequestId:saved.id,expectedFingerprint:'wrong'}),{code:'APPLICATION_CV_STALE'});
await store.publishApplicationCvVersion(job.id,saved.id,{expectedRequestId:saved.id,expectedFingerprint:saved.fingerprint});
const before=(await store.getPublicApplicationCv(first.publicId));
assert.equal(before.report.secret,undefined);
assert.equal(before.version.content.experience[0].bullets[0].evidenceIds,undefined);
assert.deepEqual(before.version.content.identity.contacts,snapshot.identity.contacts);
assert.deepEqual(before.version.content.projects[0].links,[{label:'View Fit',href:'https://fit.example/work'}]);
assert.deepEqual(before.version.content.projects[1].links,[]);
assert.equal(JSON.stringify(before).includes('sourceSnapshot'),false);
assert.equal(JSON.stringify(before).includes('requirementMap'),false);
assert.equal((await store.getApplicationCvSummaries([job.id]))[job.id].currentVersion.sourceFingerprint,snapshot.fingerprint);
await store.markApplicationCvSubmitted(job.id);
assert.equal((await store.getApplicationCv(job.id)).submittedVersionId,saved.id);
const merged=await store.updateApplicationCvRun(job.id,saved.id,{status:'queued',phase:'queued',runId:'trigger-run'});
assert.equal(merged.status,'completed');assert.equal(merged.phase,'completed');assert.equal(merged.runId,'trigger-run');
await store.claimApplicationCvRun(job,{requestId:'request-2',fingerprint:'fp-2',status:'queued'});
await assert.rejects(store.updateApplicationCvRun(job.id,'request-1',{status:'completed'}),{code:'APPLICATION_CV_RUN_REPLACED'});
const second=await store.saveApplicationCvVersion(job.id,{...privateVersion,id:'request-2',fingerprint:'fp-2'});
await assert.rejects(store.publishApplicationCvVersion(job.id,saved.id,{expectedRequestId:second.id,expectedFingerprint:saved.fingerprint,historical:true,allowAfterSubmission:true}),{code:'APPLICATION_CV_BUSY'});
await assert.rejects(store.publishApplicationCvVersion(job.id,second.id,{expectedRequestId:second.id,expectedFingerprint:second.fingerprint}),{code:'APPLICATION_CV_SUBMITTED'});
await store.publishApplicationCvVersion(job.id,second.id,{expectedRequestId:second.id,expectedFingerprint:second.fingerprint,allowAfterSubmission:true});
assert.equal((await store.getApplicationCv(job.id)).submittedVersionId,saved.id);
await store.publishApplicationCvVersion(job.id,saved.id,{expectedRequestId:second.id,expectedFingerprint:saved.fingerprint,historical:true,allowAfterSubmission:true});
assert.equal((await store.getApplicationCv(job.id)).currentVersionId,saved.id);
await store.claimApplicationCvRun(job,{requestId:'request-3',fingerprint:'fp-3',status:'queued'});
const review=await store.saveApplicationCvReviewDraft(job.id,{...privateVersion,id:'request-3',fingerprint:'fp-3',validation:{status:'needs_review',issues:['overflow']},pdfBuffer:undefined});
const latestSaved=(await store.getApplicationCvSummaries([job.id]))[job.id].latestVersion;
assert.equal(latestSaved.validationStatus,'valid');
assert.equal(latestSaved.hasPdf,true);
assert.notEqual(latestSaved.id,review.id);
await assert.rejects(store.publishApplicationCvVersion(job.id,review.id,{expectedRequestId:review.id,expectedFingerprint:review.fingerprint,allowAfterSubmission:true}),{code:'APPLICATION_CV_PDF_INVALID'});
await store.updateApplicationCvRun(job.id,review.id,{status:'needs_review'});
assert.equal((await store.claimApplicationCvRun(job,{requestId:'request-4',fingerprint:'fp-4',status:'queued'})).run.requestId,'request-4');
assert.equal(publicCvVersion({...saved,validation:{status:'needs_review'}}),null);
assert.equal(applicationCvPdfUrl({...saved,pdfUrl:'https://evil.example/file.pdf'}),null);
assert.match(applicationCvPdfUrl({...saved,pdfUrl:'https://cdn.sanity.io/files/quli96gc/production/a.pdf'}),/Bernardo-Raposo-Acme-CV.pdf/);

const response=()=>({code:0,headers:{},body:null,setHeader(key,value){this.headers[key]=value;},status(code){this.code=code;return this;},send(body){this.body=body;return this;},json(body){this.body=body;return this;},end(){return this;}});
const pdfUrl='https://cdn.sanity.io/files/quli96gc/production/a.pdf';
const publicData={...before,pdfUrl,report:{...before.report,categories:[{name:'Leadership',note:'Led a team.'}],
  differentiators:[{headline:'Cross-functional delivery',detail:'Worked across teams.'}],closing:'I would welcome a conversation.'}};
const handler=createApplicationHandler(async()=>publicData,async()=>'<title><!-- TITLE --></title><!-- REPORT --><!-- CV -->',async()=>({ok:true,arrayBuffer:async()=>pdf}));
const siteHandler=createSiteHandler(()=>{throw Error('Public site page lookup should not run for applications');},handler);
const delegatedRes=response();await siteHandler({method:'GET',query:{page:'application',publicId:first.publicId}},delegatedRes);
assert.equal(delegatedRes.code,200);assert.match(delegatedRes.body,/Application CV/);
const htmlRes=response();await handler({method:'GET',query:{publicId:first.publicId}},htmlRes);
assert.equal(htmlRes.code,200);assert.match(htmlRes.body,/A tailored summary/);assert.doesNotMatch(htmlRes.body,/sourceSnapshot|requirementMap|secret/);
assert.equal((htmlRes.body.match(/Download CV · PDF/g)||[]).length,1);
assert.match(htmlRes.body,/href="tel:\+15550100123"/);
assert.doesNotMatch(htmlRes.body,/Unsafe phone/);
assert.match(htmlRes.body,/Other contributions/);
assert.match(htmlRes.body,/Open source — figma-graphql/);
assert.match(htmlRes.body,/href="https:\/\/fit\.example\/work"/);
assert.doesNotMatch(htmlRes.body,/javascript:alert|Unsafe/);
assert.match(htmlRes.body,/Speaking — React Advanced London/);
assert.ok(htmlRes.body.indexOf('The fit')<htmlRes.body.indexOf('What I bring'));
assert.ok(htmlRes.body.indexOf('What I bring')<htmlRes.body.indexOf('Application CV'));
assert.ok(htmlRes.body.indexOf('Download CV · PDF')>htmlRes.body.indexOf('Application CV'));
assert.doesNotMatch(htmlRes.body,/I would welcome a conversation|class="closing"/);
const pdfRes=response();await handler({method:'GET',query:{publicId:first.publicId,kind:'pdf'}},pdfRes);
assert.equal(pdfRes.code,200);assert.deepEqual(pdfRes.body,pdf);
const rejectRes=response();await createApplicationHandler(async()=>publicData,async()=>'',async()=>({ok:true,arrayBuffer:async()=>Buffer.from('%PDF-corrupt%%EOF')}))({method:'GET',query:{publicId:first.publicId,kind:'pdf'}},rejectRes);
assert.equal(rejectRes.code,503);
jobPresent=false;
assert.equal(await store.getPublicApplicationCv(first.publicId),null);
const block=text=>({_type:'block',children:[{_type:'span',text}]});
const syntheticPage={_id:'site-cv',cv:{name:'Bernardo Raposo',sections:[
  {label:'Experience',items:[
    ...['SingleStore','TravelRepublic','EDITED'].map(name=>({kind:'role',title:`Role · ${name}`,body:[block(`${name} delivered a public platform.`)]})),
    {kind:'paragraph',body:[block('Earlier: Founder, Connect Coimbra, a coworking business (2010 – 2014). Junior Engineer, Critical Software, health tech (2009 – 2010).')]},
  ]},
  {label:'Built recently',items:[{kind:'paragraph',body:[block('Fit: Built my job-search application with Sanity, React, Vercel and Trigger.dev, directing coding agents and reviewing delivery. Open source includes figma-graphql, a GraphQL wrapper for the Figma API.')]},{kind:'paragraph',body:[block('The Hermans Club (hermans.club). A side project.')]}]},
  {label:'Education & beyond',items:[{kind:'paragraph',body:[block('MSc and BSc in Informatics Engineering, University of Coimbra, Portugal. Speaker at React Advanced London, GraphQL Conf and Design Systems London.')]}]},
]}};
const careerText=['I owned the engineering strategy and resourcing; my engineer led day-to-day UX/implementation.',
  'I chose Next.js and Sanity for the proposed replacement.',
  'I led a mobile-first Progressive Web App.',
  'I built a React design system.',
  'I built the core data-visualisation product.',
  'I co-founded and ran Connect Coimbra.',
  'Built the web interface for onAll.'].join('\n\n');
const seed=buildApplicationCvSeed({page:syntheticPage,career:{_id:'career',body:[block(careerText)]},
  technical:{_id:'technical',body:[block('Specializations: design systems (built from scratch at EDITED and at TravelRepublic).')]}});
assert.equal(seed.filter(entry=>entry.type==='applicationCvRole').length,5);
assert.equal(seed.filter(entry=>entry.type==='applicationCvProject').length,6);
assert.equal(seed.find(entry=>entry.key==='public:project:fit').value.text,'Fit: Built my job-search application with Sanity, React, Vercel and Trigger.dev, directing coding agents and reviewing delivery.');
assert.equal(seed.find(entry=>entry.key==='public:project:figma-graphql').value.text,'Open source includes figma-graphql, a GraphQL wrapper for the Figma API.');
assert.equal(seed.find(entry=>entry.key==='public:education:coimbra').value.text,'MSc and BSc in Informatics Engineering, University of Coimbra, Portugal.');
assert.deepEqual(seed.filter(entry=>entry.key.startsWith('project:speaking:')).map(entry=>entry.value.title),
  ['Speaking — React Advanced London','Speaking — GraphQL Conf','Speaking — Design Systems London']);
assert.equal(seed.find(entry=>entry.key==='extra:singlestore-platform-vision').value.status,'proposed');
assert.equal(seed.find(entry=>entry.key==='extra:singlestore-sqrl').value.contribution,'strategy');
let settingsDoc={_id:'application-cv-settings',_rev:'editor-revision',model:'gpt-5.6-sol',prompt:'Editor-authored prompt',verifierPrompt:null};
let hasDraft=false,guardedRev='';
const fakeSeedClient={withConfig(){return this;},async fetch(query){
  if(query.includes('slug.current'))return syntheticPage;
  if(query.includes('title == "My career"'))return {_id:'career',body:[block(careerText)]};
  if(query.includes('title == "My technical range"'))return {_id:'technical',body:[block('Specializations: design systems (built from scratch at EDITED and at TravelRepublic).')]};
  if(query.includes('defined(seedKey)'))return seed.filter(x=>!x.singleton).map(x=>({_id:`existing-${x.key}`,seedKey:x.key}));
  if(query.includes('drafts.application-cv-settings'))return hasDraft?[settingsDoc,{_id:'drafts.application-cv-settings'}]:[settingsDoc];
  throw Error(`Unexpected seed query: ${query}`);
},transaction(){return {patch(id,build){assert.equal(id,'application-cv-settings');build({ifRevisionId(rev){guardedRev=rev;return {setIfMissing(fields){if(settingsDoc.verifierPrompt==null)settingsDoc={...settingsDoc,...fields};}}}});return this;},async commit(){return {};}};}};
assert.deepEqual((await seedApplicationCv({client:fakeSeedClient})).needed,['settings:verifierPrompt']);
assert.equal((await seedApplicationCv({client:fakeSeedClient,apply:true})).created,1);
assert.equal(guardedRev,'editor-revision');
assert.equal(settingsDoc.prompt,'Editor-authored prompt');
assert.equal(settingsDoc.verifierPrompt,DEFAULT_CV_VERIFIER_PROMPT);
assert.deepEqual((await seedApplicationCv({client:fakeSeedClient})).needed,[]);
settingsDoc.verifierPrompt=null;hasDraft=true;
await assert.rejects(seedApplicationCv({client:fakeSeedClient,apply:true}),/draft/);
let promptDoc={_id:'application-cv-settings',_rev:'prompt-rev',prompt:PREVIOUS_CV_WRITER_PROMPT,verifierPrompt:PREVIOUS_CV_VERIFIER_PROMPT};
let promptDraft=false,promptGuard='';
const promptClient={withConfig(){return this;},async fetch(){return promptDraft?[promptDoc,{_id:'drafts.application-cv-settings'}]:[promptDoc];},
  transaction(){return {patch(id,build){assert.equal(id,promptDoc._id);build({ifRevisionId(rev){promptGuard=rev;return {set(values){promptDoc={...promptDoc,...values};}}}});return this;},async commit(){return {};}};}};
assert.deepEqual(await updateApplicationCvPrompts({client:promptClient}),{needed:true,applied:false});
assert.equal(promptDoc.prompt,PREVIOUS_CV_WRITER_PROMPT);
assert.deepEqual(await updateApplicationCvPrompts({client:promptClient,apply:true}),{needed:false,applied:true});
assert.equal(promptGuard,'prompt-rev');
assert.equal(promptDoc.prompt,V3_CV_WRITER_PROMPT);
assert.equal(promptDoc.verifierPrompt,V3_CV_VERIFIER_PROMPT);
assert.deepEqual(await updateApplicationCvPrompts({client:promptClient}),{needed:false,applied:false});
promptDoc.prompt='Editorial change';
await assert.rejects(updateApplicationCvPrompts({client:promptClient,apply:true}),/editorial values/);
promptDraft=true;
await assert.rejects(updateApplicationCvPrompts({client:promptClient,apply:true}),/draft/);
const overviewKeys=[...Object.keys(ROLE_OVERVIEW_EVIDENCE_KEYS).map(key=>`role:${key}`),...Object.values(ROLE_OVERVIEW_EVIDENCE_KEYS)];
const overviewDocs=overviewKeys.map((key,index)=>{
  const row=seed.find(entry=>entry.key===key);
  return {_id:`overview-doc-${index}`,_rev:`overview-rev-${index}`,_type:row.type,seedKey:key,...row.value,
    ...row.parent?{roleRef:`overview-doc-${overviewKeys.indexOf(row.parent)}`}:{},
    ...row.parent?{sourceRef:row.value.source?._ref||'site-cv'}:{}};
});
let overviewDraft=false;
const overviewClient={withConfig(){return this;},async fetch(query){
  if(query.includes('slug.current'))return syntheticPage;
  if(query.includes('title == "My career"'))return {_id:'career',body:[block(careerText)]};
  if(query.includes('title == "My technical range"'))return {_id:'technical',body:[block('Specializations: design systems (built from scratch at EDITED and at TravelRepublic).')]};
  if(query.includes('_id == "application-cv-settings"'))return {_id:'application-cv-settings',_rev:'settings-rev',prompt:V3_CV_WRITER_PROMPT,verifierPrompt:V3_CV_VERIFIER_PROMPT};
  if(query.includes('seedKey in $keys'))return overviewDocs;
  if(query.includes('_id in $ids'))return overviewDraft?[{_id:'drafts.overview-doc-0'}]:[];
  throw Error(`Unexpected overview migration query: ${query}`);
}};
assert.deepEqual(await updateApplicationCvOverviews({client:overviewClient}),{needed:true,applied:false,promptFrom:'v3',
  overviewRoles:Object.keys(ROLE_OVERVIEW_EVIDENCE_KEYS)});
overviewDraft=true;
await assert.rejects(updateApplicationCvOverviews({client:overviewClient}),/drafts/);
overviewDraft=false;
overviewDocs.find(row=>row.seedKey==='extra:critical-onall').status='proposed';
await assert.rejects(updateApplicationCvOverviews({client:overviewClient}),/source for critical-software changed/);
const splitKeys=['project:fit','public:project:fit','education:coimbra','public:education:coimbra'];
const splitDocs=splitKeys.map((key,index)=>{
  const entry=seed.find(row=>row.key===key);
  return {_id:`split-${index}`,_rev:`split-rev-${index}`,_type:entry.type,seedKey:key,...entry.value,
    ...(entry.parent?{sourceRef:'site-cv',projectRef:entry.parent==='project:fit'?'split-0':null,
      educationRef:entry.parent==='education:coimbra'?'split-2':null,text:entry.value.sourcePassage}:{})};
});
let splitDraft=false;
const splitClient={withConfig(){return this;},async fetch(query){
  if(query.includes('slug.current'))return syntheticPage;
  if(query.includes('title == "My career"'))return {_id:'career',body:[block(careerText)]};
  if(query.includes('title == "My technical range"'))return {_id:'technical',body:[block('Specializations: design systems (built from scratch at EDITED and at TravelRepublic).')]};
  if(query.includes('seedKey in $keys'))return splitDocs;
  if(query.includes('_id in $ids'))return splitDraft?[{_id:'drafts.split-0'}]:[];
  throw Error(`Unexpected project/speaking migration query: ${query}`);
}};
const splitPlan=await splitApplicationCvProjectsSpeaking({client:splitClient});
assert.deepEqual(splitPlan.patched,['public:project:fit','public:education:coimbra']);
assert.equal(splitPlan.created.length,8);
splitDraft=true;
await assert.rejects(splitApplicationCvProjectsSpeaking({client:splitClient}),/drafts/);
splitDraft=false;
splitDocs.find(row=>row.seedKey==='public:project:fit').text='Editor-approved different wording.';
await assert.rejects(splitApplicationCvProjectsSpeaking({client:splitClient}),/edited/);
let phonePage={_id:'published-cv',_rev:'contact-rev',cv:{contacts:[
  {_type:'object',_key:'existing-email',label:'Email',href:'mailto:b@example.com'},
  {_type:'object',_key:'existing-site',label:'Website',href:'https://example.com'}]}};
let phoneDraft=false,phoneGuardedRev='';
const phoneClient={withConfig(){return this;},async fetch(query){
  if(query.includes('slug.current'))return structuredClone(phonePage);
  if(query.includes('[0]{_id}'))return phoneDraft?{_id:'drafts.published-cv'}:null;
  if(query.includes('cv{contacts'))return structuredClone(phonePage);
  throw Error(`Unexpected phone migration query: ${query}`);
},transaction(){let next;return {patch(id,build){assert.equal(id,phonePage._id);
  build({ifRevisionId(rev){phoneGuardedRev=rev;return {set(fields){next=fields['cv.contacts'];}}}});return this;},
  async commit(){phonePage={...phonePage,_rev:'contact-rev-2',cv:{contacts:next}};return {};}};}};
assert.deepEqual(await addApplicationCvPhone({client:phoneClient,number:'+15550100123',label:'+1 555 010 0123'}),
  {needed:true,applied:false});
phoneDraft=true;
await assert.rejects(addApplicationCvPhone({client:phoneClient,number:'+15550100123',label:'+1 555 010 0123',apply:true}),/draft/);
phoneDraft=false;
assert.deepEqual(await addApplicationCvPhone({client:phoneClient,number:'+15550100123',label:'+1 555 010 0123',apply:true}),
  {needed:false,applied:true});
assert.equal(phoneGuardedRev,'contact-rev');
assert.equal(phonePage.cv.contacts[1].href,'tel:+15550100123');
assert.deepEqual(await addApplicationCvPhone({client:phoneClient,number:'+15550100123',label:'+1 555 010 0123',apply:true}),
  {needed:false,applied:false});
await assert.rejects(addApplicationCvPhone({client:phoneClient,number:'+15550100123',label:'Different',apply:true}),/edited/);
const validationPayload=status=>({payload:JSON.stringify({status})});
const summaryClient={async fetch(query){
  if(query.includes('_type == "applicationCvBinding"'))return [{_id:'binding-one',jobId:'job-saved',publicId:'public-saved',run:{status:'completed',publication:'saved'}}];
  if(query.includes('_type == "applicationCvVersion"')){assert.match(query,/defined\(pdf\.asset->url\)/);return [
    {bindId:'binding-one',requestId:'dangling',createdAt:'2026-10-06T03:00:00Z',validation:validationPayload('valid'),pdfSha256:'sha',pdfAssetRef:''},
    {bindId:'binding-one',requestId:'review',createdAt:'2026-10-06T02:00:00Z',validation:validationPayload('needs_review'),pdfSha256:'sha',pdfAssetRef:'asset',pdfUrl:'https://cdn.sanity.io/files/quli96gc/production/review.pdf'},
    {bindId:'binding-one',requestId:'saved-valid',createdAt:'2026-10-06T01:00:00Z',model:'gpt-5.6-sol',validation:validationPayload('valid'),pdfSha256:'sha',pdfAssetRef:'asset',pdfUrl:'https://cdn.sanity.io/files/quli96gc/production/valid.pdf'}];}
  throw Error('Unexpected summary query');
}};
assert.equal((await createApplicationCvStore(summaryClient).getApplicationCvSummaries(['job-saved']))['job-saved'].latestVersion.id,'saved-valid');
const originalReadToken=process.env.SANITY_READ_TOKEN,originalWriteToken=process.env.SANITY_WRITE_TOKEN;
try {
  process.env.SANITY_READ_TOKEN='read-only-test-token';
  delete process.env.SANITY_WRITE_TOKEN;
  assert.equal(await getPublicApplicationCv('bad'),null);
} finally {
  if(originalReadToken===undefined)delete process.env.SANITY_READ_TOKEN;else process.env.SANITY_READ_TOKEN=originalReadToken;
  if(originalWriteToken===undefined)delete process.env.SANITY_WRITE_TOKEN;else process.env.SANITY_WRITE_TOKEN=originalWriteToken;
}
console.log('application CV source, store, public privacy and PDF delivery: ok');
console.log('passed 1, failed 0');
