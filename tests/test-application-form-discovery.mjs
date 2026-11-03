import assert from 'node:assert/strict';
import { discoverApplication, applicationUrl } from '../lib/application-form-discovery.js';
import { publicApplicationHost, inspectApplicationDocument } from '../lib/application-form-reader.js';
import { DEFAULT_POSTING_CHECK } from '../lib/sanity/posting-check-settings.js';
import { postingActionPatch, postingCheckProgress, executePostingCheck } from '../lib/posting-check.js';
import { saveJob, getJob } from '../lib/store.js';
import { initialSettingsDocument } from '../lib/sanity/settings-document.js';
import { settingsFromDocument, withSettingsSnapshot } from '../lib/sanity/analysis-settings.js';

const job = { id: 'synthetic', company: 'Example', role: 'Engineering Manager', sourceUrl: 'https://www.linkedin.com/jobs/view/123' };
const url = 'https://careers.example.com/jobs/123/apply';
const search = async () => ({ text: JSON.stringify({ url }), blocks: [{ type: 'web_search_tool_result', content: [{ url }] }] });
assert.equal((await discoverApplication(job, DEFAULT_POSTING_CHECK, { search })).url, url);
assert.equal((await discoverApplication(job, DEFAULT_POSTING_CHECK, { search: async () => ({ text: JSON.stringify({url}), blocks: [] }) })).url, '');
assert.equal(applicationUrl(job.sourceUrl), '');
assert.equal(applicationUrl('https://user:pass@careers.example.com/x'), '');
assert.equal(await publicApplicationHost(url, async () => [{address:'127.0.0.1'}]), false);
assert.equal(await publicApplicationHost(url, async () => [{address:'10.0.0.1'}]), false);
assert.equal(await publicApplicationHost(url, async () => [{address:'169.254.169.254'}]), false);
assert.equal(await publicApplicationHost(url, async () => [{address:'8.8.8.8'}]), true);
await assert.rejects(discoverApplication(job, {}, { search }), /Publish/);

const postingCheck = {checkedAt:'now',form:{complete:true,questions:[{id:'q1',text:'Email',required:true,kind:'contact',state:'pending',maxLength:20}]}};
assert.throws(() => postingActionPatch({postingCheck},{action:'skip-answer',questionId:'q1'}), /Required/);
assert.throws(() => postingActionPatch({postingCheck},{action:'approve-answer',questionId:'q1',answer:'x'.repeat(21)}), /20 characters/);
const patch=postingActionPatch({postingCheck},{action:'approve-answer',questionId:'q1',answer:'example@example.com'});
assert.equal(postingCheckProgress(patch).answersReady,true);
patch.postingCheck.form.complete=false;
assert.equal(postingCheckProgress(patch).answersReady,false);
const saved = await saveJob({...job,stage:'reviewing'});
const settings=settingsFromDocument({...initialSettingsDocument(),postingCheck:{...DEFAULT_POSTING_CHECK,enabled:true}});
await withSettingsSnapshot(settings,()=>executePostingCheck({jobId:saved.id},{
  discover: (job,policy)=>discoverApplication(job,policy,{search}),
  readForm: async discovered => {
    assert.equal(discovered,url);
    return {source:'website',url,complete:true,status:'ready',questions:[{id:'email',text:'Email address',kind:'contact',required:true}]};
  },
  evaluate:()=>{throw Error('No recruiter questions should be generated');},
}));
const checked=(await getJob(saved.id)).postingCheck;
assert.equal(checked.form.url,url);assert.equal(checked.form.questions[0].needsYou,true);
assert.deepEqual(checked.gaps,[]);assert.equal(postingCheckProgress({postingCheck:checked}).answersReady,false);
console.log('passed 18, failed 0');

// Optional browser check uses synthetic HTML only, with no provider requests.
if (process.argv.includes('--browser')) {
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined});
  try {
    const page=await browser.newPage();
    await page.setContent(`<form><label for="email">Email *</label><input id="email" type="email" required maxlength="100">
      <label for="cv">Resume/CV *</label><input id="cv" type="file" required accept=".pdf">
      <fieldset><legend>Right to work *</legend><label><input type="radio" name="work" required>Yes</label><label><input type="radio" name="work">No</label></fieldset>
      <label for="why">Why us?</label><textarea id="why"></textarea><button type="submit">Submit application</button></form>`);
    const form=await page.evaluate(inspectApplicationDocument);
    assert.equal(form.complete,true);assert.equal(form.questions.length,4);
    assert.equal(form.questions[0].maxLength,100);assert.equal(form.questions[1].kind,'file');
    assert.deepEqual(form.questions[2].options,['Yes','No']);
    await page.locator('button').evaluate(el=>el.textContent='Continue');
    assert.equal((await page.evaluate(inspectApplicationDocument)).complete,false);
    console.log('Browser extraction: fields, files, choices, limits and incomplete steps passed.');
  } finally {await browser.close();}
}
