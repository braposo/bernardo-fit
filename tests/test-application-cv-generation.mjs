import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {applicationCvFingerprint,applicationCvJobFingerprint} from '../lib/application-cv-fingerprint.js';
import {materializeApplicationCv,validateApplicationCv,cvNeedsSemanticVerification,
  verifyApplicationCv,interpretApplicationCvVerification,estimateSelectionLines,layoutRevisionFeedback} from '../lib/application-cv-generation.js';
import {renderApplicationCvHtml,renderApplicationCvPdf,measureApplicationCvBudget} from '../lib/application-cv-render.js';

const source={identity:{name:'Test Candidate',headline:'Engineering manager',contacts:[
  {label:'test@example.com',href:'mailto:test@example.com'},
  {label:'+44 7700 900123',href:'tel:+447700900123'}]},
  roles:[{id:'r1',title:'Engineering Manager',company:'Example Co',dates:'2022–Present',location:'London',overviewEvidenceId:'e1',evidence:[
    {id:'e1',text:'Led a cross-functional team delivering a customer portal.',status:'delivered',contribution:'team',skills:[]},
    {id:'e2',text:'Built a Next.js prototype for the internal help centre.',status:'delivered',contribution:'personal',skills:['Next.js']},
    {id:'e3',text:'Proposed a Sanity migration.',status:'proposed',contribution:'strategy',skills:['Sanity']},
  ]},{id:'r2',title:'Senior Engineer',company:'Prior Co',dates:'2019–2022',location:'Remote | Retail analytics',overviewEvidenceId:'e4',evidence:[
    {id:'e4',text:'Implemented a shared component library.',status:'delivered',contribution:'personal',skills:[]},
  ]}],education:[],projects:[],settings:{maxWords:400,minBodyPx:13,prompt:'Select evidence'},fingerprint:'source-1'};
const selection={roles:[{id:'r1',bullets:[{text:'Led the cross-functional team that delivered a customer portal.',evidenceIds:['e1']}]},
    {id:'r2',bullets:[{text:'Implemented a shared component library.',evidenceIds:['e4']}]}],
  requirementMap:[{requirement:'Customer platforms',status:'direct',evidenceIds:['e1']},
    {requirement:'Infrastructure operations',status:'gap',evidenceIds:[]}]};
const fitUrl='https://fit.example.test/fit/public-123';
const {content,requirementMap}=materializeApplicationCv(source,selection,fitUrl);
assert.deepEqual(content.experience.map(role=>role.title),['Engineering Manager','Senior Engineer']);
assert.equal(content.summary,source.identity.headline);
assert.deepEqual(content.summaryEvidenceIds,[]);
assert.equal(content.experience[0].bullets[0].evidenceIds[0],'e1');
assert.equal(validateApplicationCv(content,source,requirementMap).status,'valid');
const exact=materializeApplicationCv(source,{...selection,roles:[
  {id:'r1',bullets:[{text:source.roles[0].evidence[0].text,evidenceIds:['e1']}]},
  {id:'r2',bullets:[{text:source.roles[1].evidence[0].text,evidenceIds:['e4']}]}]},fitUrl).content;
assert.equal(cvNeedsSemanticVerification(exact,source),false);
const narrowed=structuredClone(content);
narrowed.experience[0].bullets=[{text:'Built a Next.js prototype for the internal help centre.',evidenceIds:['e2']}];
assert.ok(validateApplicationCv(narrowed,source,requirementMap).issues.some(issue=>issue.code==='OVERVIEW_MISSING'));
assert.equal(interpretApplicationCvVerification(JSON.stringify({safe:true,issues:[],overviewCoverage:[
  {roleId:'r1',covered:false},{roleId:'r2',covered:true}]}),source).status,'needs_review');
assert.equal(interpretApplicationCvVerification(JSON.stringify({safe:true,issues:[]}),source).status,'needs_review');
assert.equal(interpretApplicationCvVerification('null',source).status,'needs_review');
assert.equal(interpretApplicationCvVerification(JSON.stringify({safe:true,issues:[],overviewCoverage:[
  {roleId:'r1',covered:true},{roleId:'r2',covered:true}]}),source).status,'valid');
assert.equal(cvNeedsSemanticVerification(content,source),true);
await assert.rejects(verifyApplicationCv({content,sourceSnapshot:source,model:'gpt-5.6-sol',requestId:'offline'}),
  error=>error.code==='CV_SETTINGS_MISSING');
assert.throws(()=>materializeApplicationCv(source,{...selection,roles:[{id:'r1',bullets:[{text:'Built the migration.',evidenceIds:['e3']}]}]},fitUrl),/unsupported evidence/);
const badMetric=structuredClone(content);
badMetric.experience[0].bullets[0].text='Led 25 engineers on the portal.';
assert.ok(validateApplicationCv(badMetric,source,requirementMap).issues.some(issue=>issue.code==='UNSUPPORTED_METRIC'));
const inflated=structuredClone(content);
inflated.experience[0].bullets[0].text='Built the customer portal single-handedly.';
assert.ok(validateApplicationCv(inflated,source,requirementMap).issues.some(issue=>issue.code==='CONTRIBUTION_INFLATION'));
const proposed=structuredClone(content);
proposed.experience[0].bullets[0].text='Shipped a Sanity migration for the portal.';
assert.ok(validateApplicationCv(proposed,source,requirementMap).issues.some(issue=>issue.code==='UNSUPPORTED_SKILL'));
const injectedProfile=materializeApplicationCv(source,{...selection,summary:'Founder and AI expert',summaryEvidenceIds:['e1']},fitUrl).content;
assert.equal(injectedProfile.summary,source.identity.headline);
assert.deepEqual(injectedProfile.summaryEvidenceIds,[]);
const changedProfile=structuredClone(content);
changedProfile.summary='Founder and AI expert';
assert.ok(validateApplicationCv(changedProfile,source,requirementMap).issues.some(issue=>issue.code==='PROFILE_CHANGED'));
changedProfile.identity.headline='AI founder';
assert.ok(validateApplicationCv(changedProfile,source,requirementMap).issues.some(issue=>issue.code==='HEADLINE'));
const malicious=structuredClone(content);
malicious.experience[0].bullets[0].text='<script>alert(1)</script>';
const projectsAndSpeaking={...content,projects:[
  {title:'Open source',company:'Community projects',dates:'2024',bullets:[{text:'Published a reusable interface checker and a data playground.'}],links:[
    {label:'Interface checker',href:'https://example.test/checker'},
    {label:'Data playground',href:'https://example.test/playground'},
    {label:'Unsafe link',href:'javascript:alert(1)'}]},
  {title:'Conference talk: Designing accessible product systems',company:'Product Engineering Summit',dates:'2025',bullets:[{text:'Shared practical techniques with product teams.'}]},
]};
const html=await renderApplicationCvHtml({...malicious,projects:projectsAndSpeaking.projects});
assert.ok(html.includes('&lt;script&gt;'));
assert.ok(!html.includes('<script>alert(1)</script>'));
const projectsHeading=html.indexOf('<h2>Other contributions</h2>');
const openSourceEntry=html.indexOf('Open source');
const speakingEntry=html.indexOf('Conference talk: Designing accessible product systems');
assert.ok(projectsHeading>=0 && projectsHeading<openSourceEntry && openSourceEntry<speakingEntry);
assert.ok(html.includes('<span class="entry-place">Remote</span><span class="entry-place">Retail analytics</span>'));
const {pdfBytes,layout}=await renderApplicationCvPdf(projectsAndSpeaking,{minBodyPx:13});
if(process.env.CV_TEST_PDF)await writeFile(process.env.CV_TEST_PDF,pdfBytes);
assert.ok(pdfBytes.length>1000);
assert.ok(layout.fontsReady);
const pdfLoading=(await import('pdfjs-dist/legacy/build/pdf.mjs')).getDocument({data:new Uint8Array(pdfBytes),useSystemFonts:false,disableFontFace:true});
const pdfDocument=await pdfLoading.promise;
try {
  const pdfText=(await (await pdfDocument.getPage(1)).getTextContent()).items.map(item=>item.str||'').join(' ').replace(/\s+/g,'').toLowerCase();
  assert.ok(pdfText.includes('othercontributions'));
  assert.ok(pdfText.includes('+447700900123'));
  const links=await (await pdfDocument.getPage(1)).getAnnotations({intent:'display'});
  assert.ok(links.some(link=>link.url==='tel:+447700900123' || link.unsafeUrl==='tel:+447700900123'));
  assert.ok(links.some(link=>link.url==='https://example.test/checker'));
  assert.ok(links.some(link=>link.url==='https://example.test/playground'));
  assert.ok(!links.some(link=>link.url?.startsWith('javascript:')));
} finally {await pdfLoading.destroy();}
const overfull=structuredClone(content);
overfull.experience[0].bullets=Array.from({length:9},()=>({text:'A deliberately lengthy evidence sentence describing engineering delivery and collaboration. '.repeat(16),evidenceIds:['e1']}));
let overflowLayout=null;
await assert.rejects(renderApplicationCvPdf(overfull,{minBodyPx:13}),error=>{overflowLayout=error.layout;return error.code==='CV_PDF_OVERFLOW';});
assert.ok(overflowLayout.spacePx<0);
assert.equal(overflowLayout.bulletLines[0].length,9);
assert.ok(overflowLayout.bulletLines[0].every(lines=>lines>=10));
// The writer is told how many wrapped bullet lines fit before it writes.
const budget=await measureApplicationCvBudget(content,{minBodyPx:13});
assert.equal(budget.roles,content.experience.length);
assert.ok(budget.maxLines>=20 && budget.maxLines<60,`unexpected line budget ${budget.maxLines}`);
assert.ok(budget.charsPerLine>=70 && budget.charsPerLine<=110,`unexpected characters per line ${budget.charsPerLine}`);
assert.ok(budget.extraBulletLineCost>0 && budget.extraBulletLineCost<1);
// A draft filling the budget with two-line bullets renders on one page.
const twoLine='Led the web platform team through a migration that improved delivery speed, accessibility and editorial workflows for product teams.'
  .slice(0,Math.floor(budget.charsPerLine*1.6));
const filled=structuredClone(content);
filled.experience.forEach(role=>{role.bullets=[];});
for (let index=0,lines=0;;index++) {
  const role=filled.experience[index%filled.experience.length],cost=2+(role.bullets.length?budget.extraBulletLineCost:0);
  if (role.bullets.length>=3 || lines+cost>budget.maxLines) break;
  role.bullets.push({text:twoLine,evidenceIds:['e1']});lines+=cost;
}
const filledSelection={roles:filled.experience.map(role=>({id:role.roleId,bullets:role.bullets}))};
assert.ok(estimateSelectionLines(filledSelection,budget)<=budget.maxLines);
assert.ok((await renderApplicationCvPdf(filled,{minBodyPx:13})).layout.spacePx>=0);
const feedback=layoutRevisionFeedback({selection:{roles:[{id:'r1',bullets:overfull.experience[0].bullets}]},
  issues:[{code:'CV_PDF_OVERFLOW',message:'CV exceeds one readable A4 page.'}],layout:overflowLayout,budget,sourceSnapshot:source});
assert.ok(feedback.overLines>0);
assert.equal(feedback.usedLines,overflowLayout.bulletLines.flat().reduce((sum,lines)=>sum+lines,0));
assert.ok(feedback.targetLines<feedback.usedLines-feedback.overLines);
assert.equal(feedback.roles[0].bullets[0].renderedLines,overflowLayout.bulletLines[0][0]);
const job={id:'job-1',fitReportId:'report-1',company:'Example',role:'Manager',jobDescription:'Lead a portal team',instructions:''};
assert.notEqual(applicationCvJobFingerprint(job),applicationCvJobFingerprint({...job,jobDescription:'Different'}));
assert.notEqual(applicationCvFingerprint(job,source,{id:'report-1'},'gpt-5.6-sol'),
  applicationCvFingerprint(job,{...source,fingerprint:'source-2'},{id:'report-1'},'gpt-5.6-sol'));
assert.notEqual(applicationCvFingerprint(job,source,{id:'report-1'},'gpt-5.6-sol','Tailor for product'),
  applicationCvFingerprint(job,source,{id:'report-1'},'gpt-5.6-sol','Tailor for platform'));
console.log('passed 29, failed 0');
