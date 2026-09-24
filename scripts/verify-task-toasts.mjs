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
const secondJob = { ...job, id: 'job2', company: 'Second company', questions: [] };
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
      if (url.searchParams.has('q')) return reply({ matchingIds: [job, secondJob].filter(item => (item.company + ' ' + item.role).toLowerCase().includes(url.searchParams.get('q').toLowerCase())).map(item => item.id) });
      return reply(url.searchParams.has('id') ? { job: url.searchParams.get('id') === 'job2' ? secondJob : job } : { jobs: [job, secondJob], stages: ['new'], features: { jevEnabled: true } });
    }
    if (url.pathname === '/api/admin/versions') return reply({});
    if (url.pathname === '/api/admin/cover') {
      if (body?.action === 'review') return reply({ review: { effectiveKind: body.kind, fingerprint: 'reviewed', model: 'gpt-5.6-sol', submitLabel: 'Generate letter', description: 'Write a cover letter.' } });
      if (req.method() === 'POST') { dispatches++; runKinds.set('run' + dispatches, body.kind); if (body.kind === 'cover') job.coverRun = { runId: 'run' + dispatches, status: 'queued' }; return reply({ runId: 'run' + dispatches, kind: body.kind }, 202); }
      if (url.searchParams.get('realtime')) return reply({ runId: url.searchParams.get('run'), kind: runKinds.get(url.searchParams.get('run')), publicAccessToken: 'fixture-token' });
      job.coverRun = { runId: 'run1', status: status === 'COMPLETED' ? 'completed' : 'failed' };
      for (const item of [job, secondJob]) if (item.jevRun?.runId === url.searchParams.get('run') && ['COMPLETED', 'FAILED'].includes(status)) {
        item.jevRun.status = status === 'COMPLETED' ? 'completed' : 'failed';
      }
      return reply({ terminal: ['COMPLETED', 'FAILED'].includes(status), status, kind: runKinds.get(url.searchParams.get('run')), result: { outcome: 'completed', words: 320, assessed: 1, failed: 0 }, error: status === 'FAILED' ? 'Provider unavailable' : undefined });
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
  assert.equal(await page.locator('.row-status').textContent(), '', 'background work uses the toast instead of the role status line');
  assert.equal(await page.locator('[data-act=cover]').textContent(), 'Generate new version', 'disabled action does not repeat the task phase');
  await page.evaluate(() => { window.pipelineBeforeSelection = document.querySelector('.pipeline'); });
  await page.locator('[data-select-job=job2]').click();
  assert.equal(await page.evaluate(() => document.querySelector('.pipeline') === window.pipelineBeforeSelection), true, 'job selection keeps pipeline mounted');
  assert.equal(await page.locator('.task-toast-message').filter({ hasText: 'Writing…' }).count(), 1, 'job selection keeps toast visible');
  await page.locator('[data-select-job=job1]').click();
  await page.goBack();
  assert.match(page.url(), /job=job2/);
  assert.equal(await page.evaluate(() => document.querySelector('.pipeline') === window.pipelineBeforeSelection), true, 'browser Back keeps pipeline mounted');
  await page.goForward();
  assert.match(page.url(), /job=job1/);
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
  assert.match(await page.locator('[data-task-id="run:run1"] button[aria-label^="Dismiss"]').textContent(), /^Dismiss \([1-5]s\)$/, 'successful notification shows a countdown');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: new URL(`../.toast-screenshots/success-${width}.png`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
  }
  await page.waitForFunction(() => !document.querySelector('[data-act=cover]').disabled);
  assert.match(await page.locator('.task-toast a').getAttribute('href'), /job=job1/);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#search').fill('Engineering');
  await page.locator('#stagefilter').selectOption('new');
  await page.waitForFunction(() => document.querySelectorAll('[data-select-job]').length === 2);
  await page.evaluate(() => { window.pipelineBeforeToastLink = document.querySelector('.pipeline'); });
  await page.locator('[data-select-job=job2]').click();
  await page.locator('.task-toast a').click();
  assert.equal(new URL(page.url()).searchParams.get('job'), 'job1');
  assert.equal(new URL(page.url()).searchParams.get('stage'), 'new');
  assert.equal(new URL(page.url()).searchParams.get('q'), 'Engineering');
  assert.equal(await page.locator('#search').inputValue(), 'Engineering');
  assert.equal(await page.locator('#stagefilter').inputValue(), 'new');
  assert.equal(await page.evaluate(() => document.querySelector('.pipeline') === window.pipelineBeforeToastLink), true, 'toast role link navigates within admin');
  await page.goBack();
  assert.equal(new URL(page.url()).searchParams.get('job'), 'job2');
  assert.equal(await page.locator('#search').inputValue(), 'Engineering');
  await page.goForward();
  const axe = await new AxeBuilder({ page }).include('.task-toast-viewport').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  assert.deepEqual(axe.violations, []);
  await page.getByRole('button', { name: 'Dismiss Cover letter', exact: false }).click();
  assert.equal(await page.locator('.task-toast').count(), 0);
  await page.locator('[data-act=cover]').click(); await page.locator('[data-review-submit]:enabled').click();
  await page.waitForFunction(() => window.fixtureRuns?.run2);
  status = 'FAILED'; await page.evaluate(() => window.fixtureRuns.run2.onUpdate({ status: 'FAILED' }));
  await page.locator('.task-toast-message').filter({ hasText: 'Provider unavailable' }).waitFor();
  assert.equal(await page.locator('[data-task-id="run:run2"] button[aria-label^="Dismiss"]').textContent(), 'Dismiss', 'failed notification has no countdown');
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
  // Two roles stay independent even when their updates and completion interleave.
  await page.locator('[data-select-job=job1]').click();
  await page.locator('[data-act=jevscore]').click();
  await page.locator('[data-review-submit]:enabled').click();
  const firstAssessment = 'run' + dispatches;
  await page.waitForFunction(id => window.fixtureRuns?.[id], firstAssessment);
  await page.locator('[data-select-job=job2]').click();
  assert.equal(await page.locator('[data-act=jevscore]').isEnabled(), true);
  await page.locator('[data-act=jevscore]').click();
  await page.locator('[data-review-submit]:enabled').click();
  const secondAssessment = 'run' + dispatches;
  await page.waitForFunction(id => window.fixtureRuns?.[id], secondAssessment);
  await page.evaluate(([a,b]) => {
    window.fixtureRuns[a].onUpdate({ status:'EXECUTING', metadata:{phase:'scoring'} });
    window.fixtureRuns[b].onUpdate({ status:'WAITING' });
  }, [firstAssessment,secondAssessment]);
  const firstToast = page.locator('[data-task-id="run:' + firstAssessment + '"]');
  const secondToast = page.locator('[data-task-id="run:' + secondAssessment + '"]');
  await firstToast.getByText('Assessing fit…', {exact:true}).waitFor();
  await secondToast.getByText('Waiting…', {exact:true}).waitFor();
  status = 'COMPLETED';
  await page.evaluate(id => window.fixtureRuns[id].onUpdate({ status:'COMPLETED' }), firstAssessment);
  await firstToast.getByText('Fit assessment ready', {exact:true}).waitFor();
  assert.equal(await page.locator('[data-act=jevscore]').isDisabled(), true, 'other role stays locked');
  assert.equal(await secondToast.getByText('Waiting…', {exact:true}).count(), 1);
  await page.evaluate(id => window.fixtureRuns[id].onUpdate({ status:'COMPLETED' }), secondAssessment);
  await secondToast.getByText('Fit assessment ready', {exact:true}).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-act=jevscore]').disabled);
  // A later run on the same button keeps the preceding run's result visible.
  await page.locator('[data-act=jevscore]').click();
  await page.locator('[data-review-submit]:enabled').click();
  const nextAssessment = 'run' + dispatches;
  await page.waitForFunction(id => window.fixtureRuns?.[id], nextAssessment);
  assert.equal(await secondToast.getByText('Fit assessment ready', {exact:true}).count(), 1);
  await page.evaluate(id => window.fixtureRuns[id].onUpdate({ status:'COMPLETED' }), nextAssessment);
  await page.waitForFunction(() => !document.querySelector('[data-act=jevscore]').disabled);
  const countdown = page.locator('[data-task-id="run:' + nextAssessment + '"] button[aria-label^="Dismiss"]');
  await countdown.getByText(/\([1-4]s\)/).waitFor();
  await page.evaluate(async id => {
    const { taskToast } = await import('/assets/task-ui-real.js');
    taskToast('run:' + id, { title: 'Updated role title' });
  }, nextAssessment);
  assert.match(await countdown.textContent(), /^Dismiss \([1-4]s\)$/, 'later updates keep the original dismissal deadline');
  await page.locator('[data-task-id="run:' + nextAssessment + '"]').waitFor({ state: 'detached', timeout: 7000 });
  assert.equal(await page.locator('[data-task-id="run:run2"]').count(), 1, 'failed notification remains until dismissed');
  await page.evaluate(([a, b]) => sessionStorage.setItem('fit.activeTasks', JSON.stringify([
    { id: 'job1', kind: 'jev-score', runId: a }, { id: 'job2', kind: 'jev-score', runId: b }
  ])), [firstAssessment, secondAssessment]);
  secondJob.jevRun = { runId: nextAssessment, status: 'queued' };
  const pointerCheck = page.waitForResponse(response => response.url().includes('run=' + nextAssessment) && !response.url().includes('realtime=1'));
  await page.reload();
  await pointerCheck;
  await page.locator('[data-select-job=job1]').waitFor();
  await page.waitForFunction(() => sessionStorage.getItem('fit.activeTasks') === '[]');
  assert.equal(await page.locator('.task-toast').count(), 0, 'finished saved runs and stale job pointers do not reopen toasts');
  await page.waitForFunction(() => !document.querySelector('[data-act=jevscore]')?.disabled);
  assert.equal(await page.locator('[data-act=jevscore]').isEnabled(), true, 'finished run releases Assess fit');
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
