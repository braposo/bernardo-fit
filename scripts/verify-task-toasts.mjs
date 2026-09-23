// Synthetic realtime events exercise the real UI without dispatching paid tasks.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
  if (path === '/assets/task-ui.js') return res.end(`
    export { taskToast } from '/assets/task-ui-real.js';
    export function subscribeRun(credentials, handlers) {
      window.fixtureRuns ||= {}; window.fixtureRuns[credentials.runId] = handlers;
      return () => { delete window.fixtureRuns[credentials.runId]; };
    }`);
  if (path === '/') {
    const html = await readFile(new URL('../lib/templates/home.html', import.meta.url), 'utf8');
    return res.end(html.replace('/* SANITY_PUBLIC_CONTENT */', 'window.PUBLIC_CONTENT = ' + JSON.stringify({ name: 'Example candidate', headingHtml: 'Assess a role', introductionHtml: 'Paste a role', placeholder: 'Job description', buttonLabel: 'Assess fit', hint: '', contactsHtml: '' }) + ';'));
  }
  const file = path === '/assets/task-ui-real.js' ? '/assets/task-ui.js' : path === '/admin' ? '/admin.html' : path;
  if (!['/admin.html','/admin-run.js','/admin-usage.js','/task-ui.css','/assets/task-ui.js','/assets/admin-ui.js','/assets/admin-ui.css'].includes(file)) { res.writeHead(404).end(); return; }
  res.end(await readFile(new URL('../public' + file, import.meta.url)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const job = { id: 'job1', company: 'Example company', role: 'Engineering Manager', stage: 'new', jobDescription: 'A detailed synthetic engineering leadership role.', questions: [{ id: 'q1', q: 'Why this role?', limit: 120 }], fitReportId: 'report1', hasCoverLetter: true, hasResearch: true, hasBrief: true };
let dispatches = 0, status = 'EXECUTING';
const runKinds = new Map();
const errors = [];
try {
  const context = await browser.newContext();
  await context.addInitScript(() => sessionStorage.setItem('bfit_admin_secret', 'fixture'));
  await context.route('**/api/**', route => {
    const req = route.request(), url = new URL(req.url()), body = req.postDataJSON();
    const reply = (json, status = 200) => route.fulfill({ json, status });
    if (url.pathname === '/api/admin/jobs') {
      if (req.method() === 'PATCH') return reply({ job });
      return reply(url.searchParams.has('id') ? { job } : { jobs: [job], stages: ['new'], features: { jevEnabled: true } });
    }
    if (url.pathname === '/api/admin/versions') return reply({});
    if (url.pathname === '/api/admin/cover') {
      if (body?.action === 'review') return reply({ review: { effectiveKind: body.kind, fingerprint: 'reviewed', model: 'gpt-5.6-sol', submitLabel: 'Generate letter', description: 'Write a cover letter.' } });
      if (req.method() === 'POST') { dispatches++; runKinds.set('run' + dispatches, body.kind); if (body.kind === 'cover') job.coverRun = { runId: 'run' + dispatches, status: 'queued' }; return reply({ runId: 'run' + dispatches, kind: body.kind }, 202); }
      if (url.searchParams.get('realtime')) return reply({ runId: url.searchParams.get('run'), kind: runKinds.get(url.searchParams.get('run')), publicAccessToken: 'fixture-token' });
      job.coverRun = { runId: 'run1', status: status === 'COMPLETED' ? 'completed' : 'failed' };
      return reply({ terminal: true, status, kind: runKinds.get(url.searchParams.get('run')), result: { outcome: 'completed', words: 320, assessed: 1, failed: 0 }, error: status === 'FAILED' ? 'Provider unavailable' : undefined });
    }
    if (url.pathname === '/api/analyze') {
      if (req.method() === 'POST') { dispatches++; return reply({ requestId: 'public_fixture_request', token: 'fixture' }, 202); }
      if (url.searchParams.get('realtime')) return reply({ runId: 'public1', publicAccessToken: 'fixture-token' });
      return reply({ terminal: true, status: 'FAILED', error: 'Please try again.' });
    }
    return reply({});
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/admin?job=job1&section=materials');
  await page.locator('[data-act=cover]').click();
  await page.locator('[data-review-submit]:enabled').click();
  await page.waitForFunction(() => window.fixtureRuns?.run1);
  assert.equal(dispatches, 1);
  assert.equal(await page.locator('[data-act=cover]').isDisabled(), true);
  await page.evaluate(() => window.fixtureRuns.run1.onUpdate({ status: 'EXECUTING', metadata: { phase: 'writing' } }));
  await page.locator('.task-toast-message').filter({ hasText: 'Writing…' }).waitFor();
  await page.locator('[data-section=overview]').click();
  await page.locator('[data-section=materials]').click();
  assert.equal(await page.locator('[data-act=cover]').isDisabled(), true);
  assert.equal(await page.locator('[data-act=researchrefresh]').isEnabled(), true);
  await page.evaluate(() => window.fixtureRuns.run1.onError(new Error('offline')));
  await page.locator('.task-toast-message').filter({ hasText: 'Reconnecting' }).waitFor();
  assert.equal(await page.locator('[data-act=cover]').isDisabled(), true);
  await page.reload();
  await page.waitForFunction(() => window.fixtureRuns?.run1);
  assert.equal(await page.locator('[data-act=cover]').isDisabled(), true);
  assert.equal(dispatches, 1);
  await page.evaluate(() => window.fixtureRuns.run1.onUpdate({ status: 'REATTEMPTING' }));
  await page.locator('.task-toast-message').filter({ hasText: 'Retrying' }).waitFor();
  await mkdir(new URL('../.toast-screenshots/', import.meta.url), { recursive: true });
  for (const width of [1280, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: new URL(`../.toast-screenshots/task-${width}.png`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
    const bounds = await page.locator('.task-toast-viewport').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
  }
  status = 'COMPLETED';
  await page.evaluate(() => window.fixtureRuns.run1.onUpdate({ status: 'COMPLETED' }));
  await page.locator('.task-toast-message').filter({ hasText: '320 words' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-act=cover]').disabled);
  assert.match(await page.locator('.task-toast a').getAttribute('href'), /job=job1/);
  const axe = await new AxeBuilder({ page }).include('.task-toast-viewport').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  assert.deepEqual(axe.violations, []);
  await page.getByRole('button', { name: 'Dismiss Cover letter', exact: false }).click();
  assert.equal(await page.locator('.task-toast').count(), 0);
  await page.locator('[data-act=cover]').click(); await page.locator('[data-review-submit]:enabled').click();
  await page.waitForFunction(() => window.fixtureRuns?.run2);
  status = 'FAILED'; await page.evaluate(() => window.fixtureRuns.run2.onUpdate({ status: 'FAILED' }));
  await page.locator('.task-toast-message').filter({ hasText: 'Provider unavailable' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-act=cover]').disabled);
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [section, selector] of [['materials','[data-act=regen]'],['materials','[data-act=researchrefresh]'],['materials','[data-act=briefrewrite]'],['materials','[data-act=qdraft]'],['overview','[data-act=jevscore]'],['overview','#assesslisted']]) {
    await page.locator('[data-section=' + section + ']').click();
    await page.locator(selector).click();
    await page.locator('[data-review-submit]:enabled').click();
    const runId = 'run' + dispatches;
    await page.waitForFunction(id => window.fixtureRuns?.[id], runId);
    assert.equal(await page.locator(selector).isDisabled(), true, selector + ' locks');
    if (selector === '[data-act=briefrewrite]') assert.equal(await page.locator('[data-act=researchrefresh]').isDisabled(), true);
    if (selector === '#assesslisted') assert.equal(await page.locator('[data-act=jevscore]').isDisabled(), true);
    status = 'COMPLETED';
    await page.evaluate(id => window.fixtureRuns[id].onUpdate({ status: 'COMPLETED' }), runId);
    await page.waitForFunction(sel => !document.querySelector(sel)?.disabled, selector);
  }
  await page.goto(origin + '/');
  await page.locator('#jd').fill('A sufficiently detailed synthetic engineering leadership role.');
  await page.locator('#go').click();
  await page.waitForFunction(() => window.fixtureRuns?.public1);
  assert.equal(await page.locator('#go').count(), 0);
  await page.evaluate(() => window.fixtureRuns.public1.onUpdate({ status: 'EXECUTING', metadata: { phase: 'analysing' } }));
  await page.locator('.task-toast-message').filter({ hasText: 'Analysing' }).waitFor();
  await page.evaluate(() => window.fixtureRuns.public1.onUpdate({ status: 'FAILED' }));
  await page.locator('#go').waitFor();
  await page.locator('.task-toast-message').filter({ hasText: 'Please try again.' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Realtime toasts verified: navigation, reload, locks, reconnect, retries, completion, failure, links, accessibility, public analysis and four viewport widths.');
} finally { await browser.close(); server.close(); }
