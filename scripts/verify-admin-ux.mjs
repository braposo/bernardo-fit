// Optional browser regression check. Requires Playwright, resolved through NODE_PATH
// or a local installation. All API calls are fixtures; no live generation is used.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const { default: AxeBuilder } = await import('@axe-core/playwright');
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname;
  if (!['/admin.html', '/admin-run.js', '/admin-usage.js', '/assets/admin-ui.js', '/assets/admin-ui.css'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(await readFile(new URL('../public' + name, import.meta.url)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
let passed = 0;
const check = (name, value) => { assert.ok(value, name); console.log('ok ' + name); passed++; };
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    sessionStorage.setItem('bfit_admin_secret', 'synthetic-fixture');
    window.open = () => ({ location: '', close() {} });
  });
  const jobs = Array.from({ length: 24 }, (_, i) => ({
    id: 'job' + i, company: i ? 'Example company ' + i : 'Example content infrastructure company with a long name',
    role: 'Engineering Manager, Developer Experience and Platform', stage: i === 1 ? 'new' : 'interviewing',
    jobDescription: 'A sufficiently detailed synthetic description for engineering leadership.', notes: '', instructions: '',
    location: 'London', salary: '', createdAt: '2026-09-15T10:00:00Z', sourceUrl: 'https://example.com/jobs/'+i, hasDescription: true, score: 80 - i, scoreBreakdown: {location:100,aiDx:75,leadership:80},
    fitReportId: i === 1 ? '' : 'fit' + i, hasCoverLetter: i !== 1, hasBrief: i !== 1,
    hasResearch: i !== 1, researchStale: true, briefStale: true,
    questions: i ? [] : [{ id: 'q1', q: 'Why this role?', limit: 120, a: 'A synthetic saved answer.' }],
  }));
  let failSave = false, dispatches = 0, reviews = 0, mutations = 0;
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
  page.on('dialog', dialog => dialog.dismiss());
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const body = request.postDataJSON();
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (url.pathname === '/api/admin/jobs') {
      if (request.method() === 'PATCH') {
        mutations++;
        if (failSave) return reply({ error: 'Fixture save failed' }, 500);
        const job = jobs.find(j => j.id === url.searchParams.get('id'));
        if (body.question) Object.assign(job.questions.find(q => q.id === body.question.id), body.question);
        else Object.assign(job, body);
        return reply({ job });
      }
      if (request.method() === 'POST') return reply({ token: 'synthetic-token' });
      if (url.searchParams.has('q')) return reply({ matchingIds: jobs.filter(j => (j.company + j.role).toLowerCase().includes(url.searchParams.get('q').toLowerCase())).map(j => j.id) });
      if (url.searchParams.get('activity') === '1') return reply({
        events: url.searchParams.get('offset') === '0' ? [{id:'e2',title:'Status changed',detail:'new → reviewing <script>unsafe()</script>',at:'2026-09-18T11:00:00Z'}] : [{id:'e1',title:'Added to pipeline',at:'2026-09-15T10:00:00Z'}],
        hasMore: url.searchParams.get('offset') === '0', snapshot: 1789732800000,
        stats: {view:12,copy_link:2,cv_download:3}, usage:{days:[{calls:1,pricedCalls:1,input:100,output:50,estimatedCostMicros:1000}],breakdown:[{kind:'analysis',model:'gpt-5.6-sol',effort:'high',calls:1,output:50,estimatedCostMicros:1000}]}
      });
      if (url.searchParams.has('id')) return reply({ job: jobs.find(j => j.id === url.searchParams.get('id')) });
      return reply({ jobs, stages: ['new', 'reviewing', 'interviewing', 'expired'], archiveOnStage: ['expired'], archivedCount: 0 });
    }
    if (url.pathname === '/api/admin/versions') {
      if (request.method() === 'POST') { mutations++; return reply({ok:true}); }
      if (url.searchParams.has('kind')) return reply({ content: { opening: 'Synthetic saved version content <script>unsafe()</script>' } });
      return reply(Object.fromEntries(['fit','letter','research','brief'].map(kind => [kind, [{vid:'v2',at:'2026-09-15T10:00:00Z',model:'gpt-5.6-sol',active:true},{vid:'v1',at:'2026-09-01',model:'claude-sonnet-5',active:false,versionInstructions:'Focus on team leadership <script>unsafe()</script>'}]])));
    }
    if (url.pathname === '/api/admin/reports') return reply({ days: [], breakdown: [] });
    if (url.pathname === '/api/admin/cover' && body?.action === 'review') {
      reviews++;
      return reply({ review: { effectiveKind: body.kind, fingerprint: 'fixture-reviewed', model: body.model || 'gpt-5.6-sol',
        submitLabel: 'Generate analysis', steps: ['Generate fixture output'], inputSummary: 'Saved fixture inputs',
        publication: 'Becomes active', costText: 'Estimate unavailable. May incur costs.' } });
    }
    if (url.pathname === '/api/admin/cover' && request.method() === 'POST') {
      dispatches++; check('dispatch carries reviewed fingerprint', body.reviewFingerprint === 'fixture-reviewed');
      return reply({ error: 'Synthetic dispatch failure' }, 503);
    }
    return reply({ error: 'Unexpected fixture request' }, 404);
  });
  await page.goto(origin + '/admin.html?job=job0');
  const audit = async name => {
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    check(name + ' has no automated WCAG A/AA violations', result.violations.length === 0 ||
      (console.log(JSON.stringify(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), null, 2)), false));
  };
  check('pipeline controls use shadcn components', await page.locator('#search').getAttribute('data-slot') === 'input' &&
    await page.locator('#stagefilter').getAttribute('data-slot') === 'native-select');
  check('approved tab names', (await page.locator('[role="tab"]').allTextContents()).join('|') === 'Overview|Documents|Role details|Activity');
  check('job card score has no repeated label', await page.locator('.pipeline-item .score-tile').first().textContent() === '80');
  check('listing uses an unboxed link variant', await page.locator('.listing-link').getAttribute('data-variant') === 'link');
  check('listing uses actual saved source', await page.locator('.listing-link').getAttribute('href') === 'https://example.com/jobs/0');
  check('document cards isolated from Overview', await page.locator('.material-row').count() === 0);
  await page.locator('.status-edit').click();
  check('status editor uses shadcn Popover', await page.locator('[data-slot="popover-content"]').isVisible());
  await page.locator('[data-act="stage"]').selectOption('reviewing');
  await page.waitForFunction(() => document.querySelector('.role-stage .pipeline-stage')?.textContent === 'Reviewing');
  check('icon status control saves the stage', jobs[0].stage === 'reviewing');
  check('three accessible shadcn rating gauges', await page.getByRole('meter').count() === 3 && await page.locator('.score-gauge[data-slot="card"]').count() === 3);
  check('gauge uses the stored score on a 100 point scale', await page.getByRole('meter', {name:'Location',exact:true}).getAttribute('aria-valuenow') === '100');
  check('Overview has no analytics or activity shortcut', await page.locator('#panel-overview .stats, #panel-overview [data-section-link="activity"]').count() === 0);
  await audit('Overview');
  if(process.env.ADMIN_UX_SCREENSHOTS) await page.screenshot({path:process.env.ADMIN_UX_SCREENSHOTS+'/admin-gauges.png'});
  await page.locator('[data-section="activity"]').click();
  await page.locator('.job-usage table').waitFor();
  check('Activity order is analytics, audit, inline usage', (await page.locator('[data-job-activity] h2').allTextContents()).join('|') === 'Analytics summary|Audit log|AI activity & usage');
  check('audit shows exact timestamps and escaped details', await page.locator('.audit-log time').getAttribute('datetime') === '2026-09-18T11:00:00Z' && (await page.locator('.audit-log').textContent()).includes('<script>unsafe()</script>') && await page.locator('.audit-log script').count() === 0);
  await page.locator('[data-activity-more]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.audit-log li').length===2);
  check('older actions append below the latest', (await page.locator('.audit-log li strong').allTextContents()).join('|') === 'Status changed|Added to pipeline');
  check('job usage is inline shadcn table without a dialog', await page.locator('.job-usage [data-slot="table"]').count() === 1 && await page.locator('[role="dialog"]').count() === 0);
  await audit('Activity');
  if(process.env.ADMIN_UX_SCREENSHOTS) await page.screenshot({path:process.env.ADMIN_UX_SCREENSHOTS+'/admin-activity.png',fullPage:true});
  for(const width of [390,360]) {
    await page.setViewportSize({width,height:900});
    check('Activity contains wide usage table at '+width, await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('[data-section="overview"]').click();
    check('gauges fit at '+width, await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await audit('Mobile gauges '+width);
    await page.locator('[data-section="activity"]').click();
    await page.locator('.job-usage').waitFor();
  }
  await page.setViewportSize({width:1280,height:900});
  await page.locator('[data-section="overview"]').click();
  await page.locator('#usagebtn').click();
  await page.locator('[data-slot="table"]').waitFor();
  check('usage uses shadcn Table inside Dialog', await page.locator('[role="dialog"] [data-slot="table"]').count() === 1);
  await audit('Usage');
  await page.locator('[data-close]').click();
  await page.locator('[data-section="context"]').click();
  check('context uses shadcn fields and labels', await page.locator('#notes').getAttribute('data-slot') === 'textarea' &&
    await page.locator('label[for="notes"]').getAttribute('data-slot') === 'label');
  await audit('Role context');
  await page.locator('#notes').fill('Draft survives a failed save');
  failSave = true;
  await page.locator('[data-section="materials"]').click();
  check('all admin buttons use shadcn primitives', await page.locator('button:not([data-slot])').count() === 0);
  await page.locator('[data-section="context"]').click();
  check('failed draft survives section navigation', await page.locator('#notes').inputValue() === 'Draft survives a failed save');
  failSave = false;
  await page.locator('#notes').focus();
  await page.locator('#company').focus();
  await page.waitForFunction(() => document.querySelector('[data-save-for="notes"]').textContent === 'Saved');
  await page.locator('[data-section="materials"]').click();
  await page.locator('[data-document="letter"] .version-summary').waitFor();
  check('document cards use shadcn Card', await page.locator('.material-row[data-slot="card"]').count() === 4);
  check('live version model and created time shown', (await page.locator('[data-document="letter"] .document-summary').textContent()).includes('Sol'));
  check('versions use shadcn Collapsible', await page.locator('[data-slot="collapsible"]').count() === 4);
  await audit('Documents');
  await page.locator('[data-act="letteropen"]').click();
  await page.locator('[data-act="briefopen"]').click();
  await page.locator('[data-act="researchopen"]').click();
  check('opening stale outputs dispatches nothing', dispatches === 0 && reviews === 0);
  await page.locator('[data-act="cover"]').click();
  await page.locator('[data-review-submit]:enabled').waitFor();
  check('review uses the shadcn Dialog', await page.locator('[role="dialog"]').getAttribute('data-slot') === 'dialog-content');
  check('dialog removes verbose copy below model', await page.locator('[data-review-body]').textContent().then(t => !t.includes('Output and versions') && !t.includes('Cost estimate unavailable')));
  await page.locator('[data-version-instructions]').fill('Highlight mentoring and platform ownership');
  await page.locator('[data-review-submit]:enabled').waitFor();
  await page.locator('[data-review-model]').selectOption('claude-sonnet-5');
  await page.locator('[data-review-submit]:enabled').waitFor();
  check('version instructions survive model changes', await page.locator('[data-version-instructions]').inputValue() === 'Highlight mentoring and platform ownership');
  await audit('Generation review');
  if (process.env.ADMIN_UX_SCREENSHOTS) await page.screenshot({path: `${process.env.ADMIN_UX_SCREENSHOTS}/admin-review.png`});
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    check('dialog traps focus, step ' + i, await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')));
  }
  await page.keyboard.press('Escape');
  check('cancelled review dispatches nothing', dispatches === 0 && reviews >= 1);
  check('dialog restores trigger focus', await page.locator('[data-act="cover"]').evaluate(el => el === document.activeElement));
  await page.locator('[data-section="materials"]').click();
  await page.locator('[data-document="brief"] [data-act="versions-toggle"]').click();
  await page.locator('[data-document="brief"] [data-act="verpreview"]').last().click();
  await page.getByText('Synthetic saved version content', { exact: false }).waitFor();
  check('version preview renders content without dispatch', dispatches === 0);
  await page.locator('[data-document="brief"] .version-instructions summary').click();
  check('additional version instructions are visible and escaped', await page.locator('[data-document="brief"] .version-instructions p').textContent() === 'Focus on team leadership <script>unsafe()</script>');
  const beforePublish = mutations;
  await page.locator('[data-document="brief"] [data-act="veruse"]').click();
  await page.waitForFunction(() => document.querySelector('.row-status')?.textContent !== 'Switching…');
  check('publishing a saved version calls the existing API', mutations === beforePublish + 1);
  await page.locator('[data-document="brief"] [data-act="versions-toggle"]').waitFor();
  check('expanded versions survive refresh', await page.locator('[data-document="brief"] [data-slot="collapsible"]').getAttribute('data-state') === 'open');
  await page.locator('[data-section="activity"]').focus();
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-section') === 'overview' && document.activeElement.getAttribute('aria-selected') === 'true');
  check('Home key selects and focuses Overview', await page.locator('[data-section="overview"]').evaluate(el => el.getAttribute('aria-selected') === 'true' && el === document.activeElement));
  await page.locator('#search').fill('Example');
  await page.waitForTimeout(350);
  check('search retains focus after response', await page.locator('#search').evaluate(el => el === document.activeElement));
  await page.locator('#search').fill('');
  check('clearing search retains focus', await page.locator('#search').evaluate(el => el === document.activeElement));
  check('desktop list scrolls independently', await page.locator('.pipeline-list').evaluate(el => el.scrollHeight > el.clientHeight));
  check('long pipeline entries contain their text', await page.locator('.pipeline-item').evaluateAll(items => items.every(el => el.scrollHeight <= el.clientHeight + 1)));
  await page.locator('[data-section="materials"]').click();
  failSave = true;
  await page.locator('[data-act="qtext"]').fill('A changed question kept after failure');
  await page.locator('[data-section="overview"]').click();
  await page.locator('[data-section="materials"]').click();
  check('failed question draft survives navigation', await page.locator('[data-act="qtext"]').inputValue() === 'A changed question kept after failure');
  failSave = false;
  await page.locator('[data-act="qtext"]').focus();
  await page.locator('[data-section="overview"]').click();
  await page.locator('[data-section="materials"]').click();
  const mutationsBeforeCancel = mutations;
  await page.locator('[data-act="qdel"]').click();
  await page.locator('[role="alertdialog"]').waitFor();
  await audit('Destructive confirmation');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  check('destructive cancellation makes no mutation', mutations === mutationsBeforeCancel);
  await page.locator('[data-act="qdraft"]').click();
  await page.locator('[data-review-submit]:enabled').waitFor();
  check('economy preference uses shadcn Checkbox', await page.locator('[data-review-economy]').getAttribute('data-slot') === 'checkbox');
  await page.locator('[data-review-economy]').click();
  await page.waitForFunction(() => localStorage.getItem('fit.economyAnswers') === 'false');
  await page.locator('[data-review-submit]:enabled').waitFor();
  await audit('Answer review');
  await page.keyboard.press('Escape');
  await page.locator('[data-select-job="job1"]').click();
  await page.locator('[data-section="materials"]').click();
  await page.locator('[data-act="runfit"]').click();
  await page.locator('[data-review-submit]:enabled').click();
  await page.getByText('Synthetic dispatch failure').waitFor();
  check('explicit submission dispatches once', dispatches === 1);
  await page.keyboard.press('Escape');
  await page.locator('[data-select-job="job0"]').click();
  for (const width of [1280, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    check('no horizontal overflow at ' + width, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (width === 390) await audit('Mobile materials');
    if (process.env.ADMIN_UX_SCREENSHOTS) await page.screenshot({ path: `${process.env.ADMIN_UX_SCREENSHOTS}/admin-${width}.png`, fullPage: true });
  }
  await page.locator('[data-act="back"]').click();
  check('mobile back shows pipeline', await page.locator('.pipeline').isVisible());
  check('no browser errors', errors.length === 0);
  console.log(`passed ${passed}, failed 0`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
