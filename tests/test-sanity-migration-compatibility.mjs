import assert from 'node:assert/strict';
import {legacyScoringFingerprint,scoringFingerprint,scoringInput,scoringQuestions,FIT_DIMENSIONS} from '../lib/jev-scoring.js';
import {JEV_MODEL,JEV_POLICY_VERSION} from '../lib/jev.js';
import {jobSummary,jobDetail} from '../lib/job-view.js';
import {initialSettingsDocument} from '../lib/sanity/settings-document.js';
import {settingsFromDocument,withSettingsSnapshot,candidateContentSignature,loadAnalysisSettings} from '../lib/sanity/analysis-settings.js';
import {saveReportWithId,saveJob,deleteJob} from '../lib/store.js';
import reportsHandler from '../api/admin/reports.js';
import {digest,researchFingerprint,researchInputsAreCurrent} from '../lib/generation-fingerprint.js';
import {researchIsReusable,RESEARCH_REUSE_MS} from '../lib/screen-work.js';
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
  assert.equal(jobSummary(edited).jevStale,true);assert.equal(jobSummary(edited).score,57);
  assert.equal(jobDetail(edited).overviewSummary,null);
}));
await test(()=>{
  const doc=initialSettingsDocument();doc.questions[0].instructions+=' Changed guidance.';
  withSettingsSnapshot(settingsFromDocument(doc),()=>assert.equal(jobSummary(job).jevStale,true));
});
await test(()=>withSettingsSnapshot({...settings,legacyFitCompatible:false},()=>{
  assert.equal(jobSummary(job).jevStale,true);
  const current={...job,jevAssessment:{...job.jevAssessment,fingerprint:scoringFingerprint(job)}};
  assert.equal(jobSummary(current).jevStale,false);
  assert.equal(jobDetail(current).overviewSummary,null,'Do not attach prose from a different assessment');
}));
await test(()=>{
  const doc=initialSettingsDocument();
  for(const key of ['interviewProfile','motivationProfile','brief','cover','answer'])doc.texts.find(t=>t.key===key).text+=' Extra writing guidance.';
  const changed=settingsFromDocument(doc);
  assert.equal(changed.legacyScoringCompatible,false);
  assert.equal(changed.legacyFitCompatible,true);
  const fingerprint=withSettingsSnapshot(settings,()=>scoringFingerprint(input));
  withSettingsSnapshot(changed,()=>{
    assert.equal(scoringFingerprint(input),fingerprint,'Unrelated writing changes do not invalidate scores');
    assert.equal(jobSummary(job).jevStale,false,'Pre-migration assessments remain current');
    assert.equal(jobDetail(job).overviewSummary.position,'Saved position');
    assert.equal(jobSummary({...job,score:null,scoreBreakdown:null}).jevStale,false,'Removing historical scores does not affect freshness');
  });
});
await test(()=>{
  // Independently reproduce the previous all-settings format used in production.
  const fingerprint=withSettingsSnapshot(settings,()=>digest({input:scoringInput(input),model:JEV_MODEL,
    settings:'d2a805d285eb770772129dce043c442604e1b62c86ba1fc565b2eb2949619c57',
    policy:'2026-09-21-stricter-fit-1',transportPolicy:JEV_POLICY_VERSION,dimensions:FIT_DIMENSIONS,questions:scoringQuestions()}));
  const saved={...job,jevAssessment:{...job.jevAssessment,fingerprint},overviewSummary:{...job.overviewSummary,fingerprint}};
  withSettingsSnapshot(settings,()=>{
    assert.equal(jobSummary(saved).jevStale,false);
    assert.equal(jobDetail(saved).overviewSummary.position,'Saved position');
    assert.equal(jobSummary({...saved,salary:'Changed'}).jevStale,true);
  });
  withSettingsSnapshot({...settings,legacyFitCompatible:false},()=>assert.equal(jobSummary(saved).jevStale,true));
});
await test(()=>{
  const original=withSettingsSnapshot(settings,()=>scoringFingerprint(input));
  for(const change of [
    doc=>{doc.texts.find(t=>t.key==='candidateProfile').text+=' New scoring evidence.';},
    doc=>{doc.questions.find(q=>q.key==='responsibilities').instructions+=' New rubric.';},
    doc=>{doc.dimensions[0].weight--;doc.dimensions[1].weight++;},
  ]) {
    const doc=initialSettingsDocument();change(doc);const changed=settingsFromDocument(doc);
    assert.equal(changed.legacyFitCompatible,false);
    withSettingsSnapshot(changed,()=>{
      assert.notEqual(scoringFingerprint(input),original);
      assert.equal(jobSummary(job).jevStale,true);
    });
  }
});
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
  assert.equal(snapshot.legacyFitCompatible,false);
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
const researchJob={company:'Example',role:'Engineering Manager',sourceUrl:'https://example.com/jobs',researchId:'research',researchAt:new Date().toISOString()};
// Original pre-migration format, independently specified here.
researchJob.researchFingerprint=digest({company:'Example',role:'Engineering Manager',domain:'example.com'});
await test(()=>withSettingsSnapshot(settings,()=>{
  assert.equal(jobSummary(researchJob).researchStale,false);
  assert.equal(researchIsReusable(researchJob,{at:researchJob.researchAt}),true);
  for(const patch of [{company:'Changed'},{role:'Changed'},{sourceUrl:'https://other.com'},{researchFingerprint:''}]) {
    assert.equal(researchInputsAreCurrent({...researchJob,...patch}),false);
  }
  assert.equal(researchIsReusable(researchJob,{at:researchJob.researchAt},Date.now()+RESEARCH_REUSE_MS+1000),false);
  assert.equal(jobSummary({...researchJob,researchAt:new Date(Date.now()-RESEARCH_REUSE_MS-1000).toISOString()}).researchStale,true);
  assert.equal(researchIsReusable(researchJob,{at:researchJob.researchAt,model:'different'},Date.now(),'sol'),false);
}));
await test(()=>withSettingsSnapshot({...settings,legacyScoringCompatible:false},()=>{
  assert.equal(researchInputsAreCurrent(researchJob),false);
  assert.equal(researchInputsAreCurrent({...researchJob,researchFingerprint:researchFingerprint(researchJob)}),true);
}));
await test(()=>{
  const doc=initialSettingsDocument();doc.questions[0].instructions+=' Changed guidance.';
  withSettingsSnapshot(settingsFromDocument(doc),()=>assert.equal(researchInputsAreCurrent(researchJob),false));
});
console.log(`passed ${passed}, failed 0`);
