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
    location: 'London', salary: '', hasDescription: true, score: 80 - i,
    fitReportId: i === 1 ? '' : 'fit' + i, hasCoverLetter: i !== 1, hasBrief: i !== 1,
    hasResearch: i !== 1, researchStale: true, briefStale: true,
    questions: i ? [] : [{ id: 'q1', q: 'Why this role?', limit: 120, a: 'A synthetic saved answer.' }],
  }));
  let failSave = false, dispatches = 0, reviews = 0, mutations = 0;
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
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
      if (url.searchParams.has('id')) return reply({ job: jobs.find(j => j.id === url.searchParams.get('id')) });
      return reply({ jobs, stages: ['new', 'interviewing', 'expired'], archiveOnStage: ['expired'], archivedCount: 0 });
    }
    if (url.pathname === '/api/admin/versions') {
      if (url.searchParams.has('kind')) return reply({ content: { opening: 'Synthetic saved version content <script>unsafe()</script>' } });
      return reply({ fit: [], letter: [], research: [], brief: [{ vid: 'v1', at: '2026-09-01', active: false }] });
    }
    if (url.pathname === '/api/admin/reports') return reply({ days: [], breakdown: [] });
    if (url.pathname === '/api/admin/cover' && body?.action === 'review') {
      reviews++;
      return reply({ review: { effectiveKind: body.kind, fingerprint: 'fixture-reviewed', model: 'gpt-5.6-sol',
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
  await audit('Overview');
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
  await page.locator('[data-act="letteropen"]').click();
  await page.locator('[data-act="briefopen"]').click();
  await page.locator('[data-act="researchopen"]').click();
  check('opening stale outputs dispatches nothing', dispatches === 0 && reviews === 0);
  await page.locator('[data-act="cover"]').click();
  await page.locator('[data-review-submit]:enabled').waitFor();
  check('review uses the shadcn Dialog', await page.locator('[role="dialog"]').getAttribute('data-slot') === 'dialog-content');
  await audit('Generation review');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    check('dialog traps focus, step ' + i, await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')));
  }
  await page.keyboard.press('Escape');
  check('cancelled review dispatches nothing', dispatches === 0 && reviews === 1);
  check('dialog restores trigger focus', await page.locator('[data-act="cover"]').evaluate(el => el === document.activeElement));
  await page.locator('[data-section="activity"]').click();
  await page.locator('[data-act="verpreview"]').click();
  await page.getByText('Synthetic saved version content', { exact: false }).waitFor();
  check('version preview renders content without dispatch', dispatches === 0);
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
