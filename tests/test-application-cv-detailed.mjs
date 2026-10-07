import assert from 'node:assert/strict';
import {tasks,idempotencyKeys} from '@trigger.dev/sdk';
import {applicationCvSourceFromDocument,withApplicationCvSource} from '../lib/application-cv-source.js';
import {buildDetailedCvContent,defaultDetailedSelection,fitDetailedCv,normalizeDetailedSelection,trimDetailedSelection,
  validateDetailedCv} from '../lib/application-cv-detailed.js';
import {renderApplicationCvHtml,renderApplicationCvPdf} from '../lib/application-cv-render.js';
import {buildGeneralApplicationCv,renderGeneralApplicationCv} from '../lib/application-cv-general.js';
import {generalCvFingerprint} from '../lib/general-cv-refresh.js';
import {publicCvVersion,createMemoryApplicationCvStore,withApplicationCvStore} from '../lib/application-cv-store.js';
import {renderPublicApplication} from '../lib/handlers/application.js';
import {saveJob,saveReport,getReport} from '../lib/store.js';
import {publicReport} from '../lib/report.js';
import {withChildGenerationContext} from '../lib/generation-context.js';
import {applicationCvFingerprint} from '../lib/application-cv-fingerprint.js';
import {executeApplicationCvWork,APPLICATION_CV_DETAILED_RENDERER_VERSION} from '../lib/application-cv-work.js';
import {planTwoPageCvSeed,PROFILE_ID,PROVENANCE_ID} from '../scripts/seed-two-page-cv.mjs';
import {TWO_PAGE_ROLES} from '../scripts/two-page-cv-content.mjs';
import {twoPageCvDocument} from './fixtures/two-page-cv.mjs';

let passed=0,failed=0;
const test=async(name,fn)=>{try{await fn();passed++;console.log('  ok   '+name);}catch(error){failed++;console.error('  FAIL '+name+'\n'+error.stack);}};
const source=applicationCvSourceFromDocument(twoPageCvDocument());
const fitUrl='https://fit.example.test/fit/abc';
const strip=doc=>({...doc,profile:undefined,settings:{...doc.settings,layout:'classic',pages:undefined,detailedPrompt:undefined},
  roles:doc.roles.map(({depth,scope,responsibilities,achievementIds,stack,startsPage,...role})=>role),
  projects:doc.projects.filter(project=>!project.featured).map(({featured,summary,scope,highlights,stack,...project})=>project)});

await test('the one-page source ignores two-page fields, the featured project and the profile',()=>{
  const classic=applicationCvSourceFromDocument(twoPageCvDocument({layout:'classic'}));
  assert.equal(classic.profile,undefined);
  assert.equal(classic.roles.some(role=>'detail' in role),false);
  assert.deepEqual(classic.projects.map(project=>project.title),['Hermans Club','Open source','Speaking']);
  assert.equal(classic.fingerprint,applicationCvSourceFromDocument(strip(twoPageCvDocument())).fingerprint);
});

await test('the two-page source carries fixed role text, the achievement pool and the profile',()=>{
  assert.equal(source.settings.layout,'detailed');assert.equal(source.settings.pages,2);
  assert.deepEqual(source.roles.map(role=>role.detail.depth),['full','full','full','short','earlier']);
  assert.equal(source.roles[0].detail.achievementIds.length,8);
  assert.equal(source.profile.skills[0].label,'Product and business');
  assert.equal(source.projects.find(project=>project.title==='Fit').detail.featured,true);
});

await test('an incomplete two-page source fails clearly',()=>{
  const broken=mutate=>{const doc=twoPageCvDocument();mutate(doc);return ()=>applicationCvSourceFromDocument(doc);};
  assert.throws(broken(doc=>{doc.roles[0].achievementIds=[];}),/two-page CV entry for SingleStore/);
  assert.throws(broken(doc=>{doc.roles[0].achievementIds=[doc.roles[1].achievementIds[0]];}),/two-page CV entry for SingleStore/);
  assert.throws(broken(doc=>{doc.roles[3].responsibilities=[];}),/Connect Coimbra/);
  assert.throws(broken(doc=>{doc.profile=null;}),/profile/);
  assert.throws(broken(doc=>{doc.settings.pages=0;}),/page limit/);
  assert.throws(broken(doc=>{doc.projects[0].highlights=[];}),/featured project Fit/);
  assert.throws(broken(doc=>{doc.settings.layout='poster';}),/layout is not supported/);
});

await test('achievement selections stay within each role\'s pool and are completed from its order',()=>{
  const [ss,tr,ed]=source.roles;
  const picked=normalizeDetailedSelection(source,{roles:[{id:ss.id,achievementIds:[ss.detail.achievementIds[7],ss.detail.achievementIds[1]]},
    {id:tr.id,achievementIds:[tr.detail.achievementIds[2]]}],
    requirementMap:[{requirement:'Docs',status:'direct',evidenceIds:[ss.detail.achievementIds[0]]},{requirement:'Bad',status:'direct',evidenceIds:['other']}]});
  assert.deepEqual(picked.roles.map(role=>role.achievementIds),[[ss.detail.achievementIds[7],ss.detail.achievementIds[1]],
    [tr.detail.achievementIds[2],tr.detail.achievementIds[0]],ed.detail.achievementIds.slice(0,2)]);
  assert.deepEqual(picked.requirementMap.map(entry=>entry.requirement),['Docs']);
  assert.throws(()=>normalizeDetailedSelection(source,{roles:[{id:ss.id,achievementIds:[tr.detail.achievementIds[0]]}]}),/approved pool/);
  assert.throws(()=>normalizeDetailedSelection(source,{roles:[{id:'unknown',achievementIds:[]}]}),/unknown role/);
  assert.throws(()=>normalizeDetailedSelection(source,null),/malformed/);
});

await test('trimming drops achievements from the fullest, oldest role first and keeps one per role',()=>{
  let selection={roles:[{id:'a',achievementIds:['a1','a2','a3']},{id:'b',achievementIds:['b1','b2','b3']},{id:'c',achievementIds:['c1','c2']}]};
  const steps=[];
  while((selection=trimDetailedSelection(selection)))steps.push(selection.roles.map(role=>role.achievementIds.length).join(''));
  assert.deepEqual(steps,['322','222','221','211','111']);
});

await test('two-page content quotes approved text and validation rejects changed wording',()=>{
  const {content}=buildDetailedCvContent(source,defaultDetailedSelection(source),{fitUrl});
  assert.deepEqual(content.experience.map(role=>role.bullets.length),[3,3,3,0]);
  assert.deepEqual(content.earlier.map(role=>role.company),['Critical Software']);
  assert.deepEqual(content.featured.map(item=>item.title),['Fit']);
  assert.equal(content.projects[0].bullets[0].text,source.projects[1].detail.summary);
  assert.equal(validateDetailedCv(content,source,[]).status,'valid');
  const changed=structuredClone(content);changed.experience[0].bullets[0].text='Invented a new achievement.';
  assert.deepEqual(validateDetailedCv(changed,source,[]).issues.map(issue=>issue.code),['UNSUPPORTED_BULLET']);
  const narrowed=structuredClone(content);narrowed.experience[1].responsibilities.pop();
  assert.deepEqual(validateDetailedCv(narrowed,source,[]).issues.map(issue=>issue.code),['ROLE_FACTS']);
});

await test('the agreed content renders within two A4 pages with every public fragment and link',async()=>{
  const fitted=await fitDetailedCv(source,defaultDetailedSelection(source),{build:selection=>buildDetailedCvContent(source,selection,{fitUrl}),
    render:renderApplicationCvPdf});
  assert.ok(fitted.rendered.layout.pageCount<=2);
  assert.ok(fitted.selection.roles.every(role=>role.achievementIds.length>=1));
  const html=await renderApplicationCvHtml(fitted.content);
  for(const text of ['Profile','Core skills','Featured project','Side projects and community','facts-label','entry-highlight','<strong class="em">problems into products</strong>'])
    assert.ok(html.includes(text),text);
  for(const text of ['Earlier career','Other contributions','Domains','**'])assert.equal(html.includes(text),false,text);
  // Critical Software closes Experience, and each role's Stack line sits between its scope and its items.
  assert.ok(html.indexOf('Critical Software')<html.indexOf('Featured project'));
  const singlestore=html.slice(html.indexOf('SingleStore</span>'),html.indexOf('TravelRepublic / Emirates Group</span>'));
  assert.ok(singlestore.indexOf('entry-scope')<singlestore.indexOf('facts-label') && singlestore.indexOf('facts-label')<singlestore.indexOf('entry-detail'));
  // EDITED is marked to open page 2, and the PDF does start it there.
  assert.match(html,/<article class="entry page-start">.{0,300}EDITED/s);
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading=getDocument({data:new Uint8Array(fitted.rendered.pdfBytes),useSystemFonts:false,disableFontFace:true});
  const pdf=await loading.promise;
  const page2=(await (await pdf.getPage(2)).getTextContent()).items.map(item=>item.str).join('').replace(/\s+/g,'');
  await loading.destroy();
  assert.ok(page2.startsWith('SeniorEngineer'),page2.slice(0,40));
});

await test('the one-page layout drops the bold markers from shared evidence',()=>{
  const classic=applicationCvSourceFromDocument(twoPageCvDocument({layout:'classic'}));
  const texts=classic.roles.flatMap(role=>role.evidence.map(e=>e.text));
  assert.ok(texts.some(text=>text.startsWith('Owned engineering strategy and resourcing for SQRL')));
  assert.equal(texts.some(text=>text.includes('**')),false);
  assert.ok(source.roles[0].evidence.some(e=>e.text.includes('**')));
});

await test('a source too long for its page limit fails instead of shrinking the text',async()=>{
  const doc=twoPageCvDocument({pages:1});
  await assert.rejects(fitDetailedCv(applicationCvSourceFromDocument(doc),defaultDetailedSelection(applicationCvSourceFromDocument(doc)),
    {build:selection=>buildDetailedCvContent(applicationCvSourceFromDocument(doc),selection,{fitUrl}),render:renderApplicationCvPdf}),/does not fit a 1-page CV/);
});

await test('the general two-page CV uses the first achievements and trims to fit',async()=>{
  const {content}=buildGeneralApplicationCv(source,{publicUrl:'https://fit.example.test/'});
  assert.equal(content.variant,'general');assert.equal(content.layout,'detailed');
  assert.deepEqual(content.experience[0].bullets.map(b=>b.evidenceIds[0]),source.roles[0].detail.achievementIds.slice(0,3));
  let renders=0;
  const result=await renderGeneralApplicationCv(source,{publicUrl:'https://fit.example.test/',render:async(cv,options)=>{
    renders++;assert.equal(options.maxPages,2);
    if(renders===1)throw Object.assign(new Error('Too long'),{code:'CV_PDF_PAGES'});
    return {pdfBytes:new Uint8Array([1]),pdfSha256:'x',layout:{pageCount:2}};
  }});
  assert.equal(renders,2);
  assert.deepEqual(result.content.experience.map(role=>role.bullets.length),[3,3,2,0]);
  const classic=applicationCvSourceFromDocument(twoPageCvDocument({layout:'classic'}));
  assert.notEqual(generalCvFingerprint(source),generalCvFingerprint(classic));
});

await test('public output and the fit page carry the two-page sections without private references',()=>{
  const {content}=buildDetailedCvContent(source,defaultDetailedSelection(source,2),{fitUrl});
  const visible=publicCvVersion({content,validation:{status:'valid'},pdfSha256:'abc',createdAt:'2026-10-07'}).content;
  assert.equal(JSON.stringify(visible).includes('evidenceIds'),false);
  assert.equal(visible.layout,'detailed');assert.equal(visible.experience[0].stack[0],'TypeScript');
  assert.equal(visible.featured[0].highlights.length,6);assert.equal(visible.earlier[0].company,'Critical Software');
  const page=renderPublicApplication({publicId:'abc',report:{job_title:'Engineering Manager',company:'Example'},version:{content:visible}},'<!-- TITLE --><!-- REPORT --><!-- CV -->');
  for(const text of ['<strong class="em">problems into products</strong>','Core skills','entry-scope','Stack','Featured project','Side projects and community','Critical Software','The common thread'])
    assert.ok(page.includes(text),text);
  for(const text of ['Earlier career','Domains','**'])assert.equal(page.includes(text),false,text);
  assert.ok(page.indexOf('Critical Software')<page.indexOf('Featured project'));
});

await test('the seed plan fills only missing fields and stops for drafts',()=>{
  const roles=Object.keys(TWO_PAGE_ROLES).map((key,index)=>({_id:`r${index}`,_rev:`v${index}`,seedKey:`role:${key}`,
    title:{singlestore:'Engineering Manager',travelrepublic:'Principal Engineer',edited:'Senior Engineer','connect-coimbra':'Co-founder','critical-software':'Junior Engineer'}[key],
    company:{singlestore:'SingleStore',travelrepublic:'TravelRepublic / Emirates Group',edited:'EDITED','connect-coimbra':'Connect Coimbra','critical-software':'Critical Software'}[key]}));
  roles[0].scope='Edited in Studio.';
  const projects=[{_id:'fit',_rev:'f',seedKey:'project:fit',dates:'',approvedPublic:false},{_id:'h',_rev:'h',seedKey:'project:hermans',summary:'Kept.'},
    {_id:'o',_rev:'o',seedKey:'contributions:project:open-source:v5'},{_id:'s',_rev:'s',seedKey:'contributions:project:speaking:v5'}];
  const state={roles,projects,settings:{_id:'application-cv-settings',_rev:'s1',layout:'classic'},profile:null,provenance:null,evidence:[],drafts:[]};
  const plan=planTwoPageCvSeed(state);
  assert.deepEqual(plan.create.map(doc=>doc._id).filter(id=>[PROVENANCE_ID,PROFILE_ID].includes(id)),[PROVENANCE_ID,PROFILE_ID]);
  assert.equal(plan.create.filter(doc=>doc._type==='applicationCvEvidence').length,14);
  const ss=plan.patches.find(row=>row.label==='role:singlestore');
  assert.equal('scope' in ss.set,false);assert.equal(ss.set.achievements.length,8);
  assert.equal(plan.patches.find(row=>row.label==='role:connect-coimbra').set.title,'Co-founder and freelance web developer');
  assert.equal(plan.patches.find(row=>row.label==='role:edited').set.startsPage,true);assert.equal('startsPage' in ss.set,false);
  assert.deepEqual(plan.patches.find(row=>row.label==='project:fit').set.featured,true);
  assert.equal(plan.patches.some(row=>row.label==='project:hermans'),false);
  assert.deepEqual(Object.keys(plan.patches.find(row=>row.label==='settings').set),['pages','detailedPrompt']);
  assert.throws(()=>planTwoPageCvSeed({...state,drafts:['drafts.r0']}),/drafts first/);
  assert.throws(()=>planTwoPageCvSeed({...state,roles:roles.map((role,index)=>index===1?{...role,title:'Changed'}:role)}),/TravelRepublic/);
});

// The tailored two-page path: one checkpointed selection call, no verifier,
// verbatim content, and an editorial-order fallback for an unusable answer.
const originalTrigger=tasks.triggerAndWait,originalKey=idempotencyKeys.create;
const providers=[];let answer=null;
idempotencyKeys.create=async key=>JSON.stringify(key);
tasks.triggerAndWait=async(id,payload)=>{providers.push(payload.provider);return {ok:true,output:{selection:structuredClone(answer)}};};
const store=createMemoryApplicationCvStore();
await withApplicationCvStore(store,()=>withApplicationCvSource(source,async()=>{
  const reportId=await saveReport({job_title:'Engineering Manager',company:'Synthetic',job_description:'Lead a web platform team.'});
  const job=await saveJob({company:'Synthetic',role:'Engineering Manager',stage:'reviewing',jobDescription:'Lead a web platform team.',fitReportId:reportId});
  const reportSnapshot={id:reportId,report:publicReport(await getReport(reportId))};
  const payload=id=>({jobId:job.id,requestId:id,model:'gpt-5.6-sol',origin:'https://fit.example',sourceSnapshot:source,
    jobSnapshot:job,reportSnapshot,reportId,fingerprint:applicationCvFingerprint(job,source,reportSnapshot,'gpt-5.6-sol')});
  const run=p=>withChildGenerationContext({runId:'trigger-parent',jobId:job.id,requestId:p.requestId},()=>executeApplicationCvWork(p));
  await test('a tailored two-page CV publishes the chosen achievements verbatim without a verifier call',async()=>{
    const [ss,tr]=source.roles;
    answer={roles:[{id:ss.id,achievementIds:[ss.detail.achievementIds[7],ss.detail.achievementIds[0]]},{id:tr.id,achievementIds:tr.detail.achievementIds.slice(0,2)}],requirementMap:[]};
    const p=payload('detailed-first');await store.claimApplicationCvRun(job,{requestId:p.requestId,fingerprint:p.fingerprint,status:'queued'});
    const result=await run(p);
    assert.equal(result.publication,'published');assert.deepEqual(providers,['cv-detailed']);
    const version=await store.getApplicationCvVersion(job.id,p.requestId);
    assert.equal(version.rendererVersion,APPLICATION_CV_DETAILED_RENDERER_VERSION);
    assert.equal(version.content.layout,'detailed');assert.ok(version.validation.layout.pageCount<=2);
    assert.equal(version.content.experience[0].bullets[0].evidenceIds[0],ss.detail.achievementIds[7]);
    assert.equal(version.verification.overviewCoverage[0].method,'verbatim');
  });
  await test('an unusable selection falls back to the editorial order and is recorded',async()=>{
    answer=null;providers.length=0;
    const p=payload('detailed-fallback');await store.claimApplicationCvRun(job,{requestId:p.requestId,fingerprint:p.fingerprint,status:'queued'});
    assert.equal((await run(p)).publication,'published');assert.deepEqual(providers,['cv-detailed']);
    const version=await store.getApplicationCvVersion(job.id,p.requestId);
    assert.equal(version.content.experience[0].bullets[0].evidenceIds[0],source.roles[0].detail.achievementIds[0]);
    assert.ok(version.validation.adjusted.issues.some(issue=>issue.code==='CV_MODEL_FORMAT'));
  });
}));
tasks.triggerAndWait=originalTrigger;idempotencyKeys.create=originalKey;

console.log(`passed ${passed}, failed ${failed}`);process.exitCode=failed?1:0;
