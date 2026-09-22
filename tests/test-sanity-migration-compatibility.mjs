import assert from 'node:assert/strict';
import {legacyScoringFingerprint,scoringFingerprint} from '../lib/jev-scoring.js';
import {jobSummary,jobDetail} from '../lib/job-view.js';
import {initialSettingsDocument} from '../lib/sanity/settings-document.js';
import {settingsFromDocument,withSettingsSnapshot,candidateContentSignature,loadAnalysisSettings} from '../lib/sanity/analysis-settings.js';
import {saveReportWithId,saveJob,deleteJob} from '../lib/store.js';
import reportsHandler from '../api/admin/reports.js';
let passed=0;
const test=async fn=>{await fn();passed++;};
const settings=settingsFromDocument(initialSettingsDocument());
const input={company:'Example',role:'Engineering Manager',jobDescription:'Manage an engineering team.',location:'UK'};
// Calculated with the pre-Sanity scoring implementation, not the new helper.
const oldFingerprint='e08ca8051db688fc83288f009ae16d98b0e975b49cf2cc4ee9e067e2e1b9179f';
const job={...input,jevAssessment:{fingerprint:oldFingerprint,score:57,dimensions:[],assessedAt:'2026-09-21'},
  overviewSummary:{fingerprint:oldFingerprint,assessedAt:'2026-09-21',position:'Saved position',fit:'Saved interpretation'}};
await test(()=>assert.equal(legacyScoringFingerprint(input),oldFingerprint));
await test(()=>withSettingsSnapshot(settings,()=>{
  assert.equal(jobSummary(job).score,57);assert.equal(jobSummary(job).jevStale,false);
  assert.equal(jobDetail(job).overviewSummary.position,'Saved position');
}));
await test(()=>withSettingsSnapshot(settings,()=>{
  const edited={...job,salary:'Changed salary'};
  assert.equal(jobSummary(edited).jevStale,true);assert.equal(jobSummary(edited).score,null);
  assert.equal(jobDetail(edited).overviewSummary,null);
}));
await test(()=>{
  const doc=initialSettingsDocument();doc.questions[0].instructions+=' Changed guidance.';
  withSettingsSnapshot(settingsFromDocument(doc),()=>assert.equal(jobSummary(job).jevStale,true));
});
await test(()=>withSettingsSnapshot({...settings,legacyScoringCompatible:false},()=>{
  assert.equal(jobSummary(job).jevStale,true);
  const current={...job,jevAssessment:{...job.jevAssessment,fingerprint:scoringFingerprint(job)}};
  assert.equal(jobSummary(current).jevStale,false);
  assert.equal(jobDetail(current).overviewSummary,null,'Do not attach prose from a different assessment');
}));
await test(()=>{
  const a={summary:[{style:'normal',children:[{text:'Candidate',_key:'one'}]}],evidence:[]};
  const b={evidence:[],summary:[{children:[{_key:'two',text:'Candidate'}],style:'normal'}]};
  assert.equal(candidateContentSignature(a),candidateContentSignature(b));
  b.summary[0].children[0].text='Edited candidate';assert.notEqual(candidateContentSignature(a),candidateContentSignature(b));
});
await test(async()=>{
  const candidate={_rev:'edited',summary:[{children:[{text:'An edited candidate profile'}]}],evidence:[]};
  const snapshot=await loadAnalysisSettings({SANITY_ANALYSIS_ENABLED:'1',SANITY_CONTENT_ENABLED:'1'},
    {fetch:async query=>query.includes('analysisSettings')?initialSettingsDocument():candidate});
  assert.equal(snapshot.legacyScoringCompatible,false);
});
await test(async()=>{
  process.env.ADMIN_SECRET='migration-test';
  await saveReportWithId('dismissed-migration-report',{company:'Test',job_title:'Role'});
  const row=await saveJob({company:'Test',role:'Role',fitReportId:'dismissed-migration-report',archived:true});
  await deleteJob(row.id,{requireArchived:true});
  const response={setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;}};
  await reportsHandler({method:'GET',headers:{'x-admin-secret':'migration-test'},query:{export:'1'}},response);
  assert.equal(response.code,200);assert.deepEqual(response.body.dismissedReportIds,['dismissed-migration-report']);
});
console.log(`passed ${passed}, failed 0`);
