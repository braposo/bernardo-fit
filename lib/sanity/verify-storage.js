import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createStorageClient,sanityStorageEnabled} from './client.js';
import {saveJob,getJob,mutateJob,saveReportWithId,getReport,getSharedReport,addReportVersion,activateReportVersion,listReportVersions,getReportRevision,deleteJob} from '../store.js';
import {saveCoverArtifact,getCoverArtifact} from '../cover-artifacts.js';
import {saveScreenArtifact,getScreenArtifact} from '../screen-artifacts.js';
import {loadAnalysisSettings} from './analysis-settings.js';

// Shared by the local smoke test and the deployed worker probe. Only disposable,
// uniquely identified fixtures are changed or removed; real content is read-only.
export async function verifySanityStorage() {
  assert.ok(sanityStorageEnabled(),'Sanity storage must be enabled');
  const client=createStorageClient();
  const prefix=`storage-check-${randomUUID()}`,jobId=`${prefix}-job`,reportId=`${prefix}-report`,qId=`${prefix}-question`;
  let checks=0;
  try {
    const settings=await loadAnalysisSettings();assert.ok(settings.revision!=='code-baseline');assert.ok(settings.texts.candidateProfile.length>100);checks++;
    await saveJob({id:jobId,company:'Storage verification',role:'Temporary test',archived:true,notes:'Initial notes',questions:[{id:qId,q:'Test question',a:'Initial answer',limit:120}]});
    let job=await getJob(jobId);assert.equal(job.questions[0].a,'Initial answer');checks++;
    const doc=await client.fetch('*[_type == "job" && legacyId == $id][0]',{id:jobId});
    await client.patch(doc._id).set({notes:'Edited in Studio'}).commit({visibility:'sync'});
    await mutateJob(jobId,current=>({instructions:'From app',questions:current.questions.map(q=>({...q,a:'Worker answer'}))}));
    job=await getJob(jobId);assert.equal(job.notes,'Edited in Studio');assert.equal(job.questions[0].a,'Worker answer');checks++;
    await Promise.all([mutateJob(jobId,()=>({notes:'Concurrent note'})),mutateJob(jobId,()=>({stage:'applied'}))]);
    job=await getJob(jobId);assert.equal(job.notes,'Concurrent note');assert.equal(job.stage,'applied');checks++;
    await assert.rejects(mutateJob(jobId,()=>({notes:'Stale overwrite'}),{expectedRevision:1}),/changed/);checks++;
    const draftId=`drafts.${doc._id}`;
    await client.createIfNotExists({_id:draftId,_type:'job',legacyId:jobId,role:'Unpublished draft'});
    await assert.rejects(mutateJob(jobId,()=>({notes:'Draft overwrite'})),/draft/);checks++;
    await client.delete(draftId);
    const report={job_title:'Temporary test',company:'Storage verification',job_description:'A temporary verification posting.',pitch:'First version',categories:[],differentiators:[],closing:'End',created_at:new Date().toISOString(),model:'test',generation:{prompt:'test',instructions:'',effort:'low'}};
    await saveReportWithId(reportId,report,null,{vid:'one'});
    await addReportVersion(reportId,{...report,pitch:'Second version'},null,{vid:'two'});
    await addReportVersion(reportId,{...report,pitch:'Second version'},null,{vid:'two'});
    assert.equal((await listReportVersions(reportId)).length,2);checks++;
    await activateReportVersion(reportId,'one');assert.equal((await getReport(reportId)).pitch,'First version');checks++;
    const currentReport=await client.fetch('*[_type == "fitReport" && legacyId == $id && current == true][0]',{id:reportId});
    await client.patch(currentReport._id).set({publiclyShared:false}).commit({visibility:'sync'});
    await activateReportVersion(reportId,'two');assert.equal(await getSharedReport(reportId),null);checks++;
    await mutateJob(jobId,()=>({fitReportId:reportId}));
    const reportRevision=await getReportRevision(reportId);
    await mutateJob(jobId,()=>({notes:'Guarded write'}),{expectedReportRevision:{id:reportId,revision:reportRevision}});checks++;
    assert.equal(await getReportRevision(reportId),reportRevision,'A revision guard must not modify the report');checks++;
    const letter={vid:'cover',salutation:'Hello',words:5,paragraphs:[{lead:true,html:'Hello <em>world</em> &amp; friends.'}]};
    await saveCoverArtifact(jobId,letter);await saveCoverArtifact(jobId,letter);
    assert.equal((await getCoverArtifact(jobId,'cover')).paragraphs[0].html,'Hello <em>world</em> &amp; friends.');checks++;
    const research={company:'Storage verification',summary:[{text:'Fact',src:1}],sources:[{id:1,title:'Source',url:'https://example.com'}],unknowns:['Unknown']};
    await saveScreenArtifact('research',jobId,'research',research);
    assert.equal((await getScreenArtifact('research',jobId,'research')).summary[0].src,1);checks++;
    await saveScreenArtifact('brief',jobId,'brief',{company:'Storage verification',opening:'Hello',why:[{text:'Posting evidence',src:'posting'}],conversation:{notes:'Notes',points:[]},confirmedAnswers:[{question:'Q',answer:'A'}]});
    assert.equal((await getScreenArtifact('brief',jobId,'brief')).confirmedAnswers[0].answer,'A');checks++;
    await mutateJob(jobId,()=>({coverLetterId:'cover',researchId:'research',briefId:'brief'}));
    job=await getJob(jobId);assert.equal(job.coverLetterId,'cover');assert.equal(job.researchId,'research');assert.equal(job.briefId,'brief');checks++;
    await deleteJob(jobId,{requireArchived:true});assert.equal(await getJob(jobId),null);checks++;
    return {ok:true,checks,storage:'sanity',projectId:'quli96gc',dataset:'production'};
  } finally {
    const docs=await client.withConfig({perspective:'raw'}).fetch('*[legacyId in $ids]{_id}',{ids:[jobId,reportId,qId]});
    let tx=client.transaction();for(const doc of docs)tx=tx.delete(doc._id);
    if(docs.length)await tx.commit({visibility:'sync'});
  }
}
