// Optional browser regression check. Requires Playwright, resolved through NODE_PATH
// or a local installation. All API calls are fixtures; no live generation is used.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const { default: AxeBuilder } = await import('@axe-core/playwright');
const baselineRevision = process.env.ADMIN_UX_BASE_REVISION || 'HEAD';
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname;
  if (!['/admin.html', '/admin-run.js', '/admin-usage.js', '/pipeline-board.js', '/assets/admin-ui.js', '/assets/admin-ui.css', '/assets/task-ui.js', '/task-ui.css'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  const source = process.env.ADMIN_UX_BASELINE && name === '/admin.html'
    ? execFileSync('git', ['show', baselineRevision + ':public/admin.html'], { encoding: 'utf8' })
    : await readFile(new URL('../public' + name, import.meta.url));
  res.end(source);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
let passed = 0;
const check = (name, value) => { assert.ok(value, name); console.log('ok ' + name); passed++; };
// Synthetic Needs you / posting check / interview timeline fixture. Every API call is stubbed
// and recorded in `calls`; nothing reaches a real backend.
async function needsFixture(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await context.addInitScript(() => { sessionStorage.setItem('bfit_admin_secret', 'synthetic-fixture'); });
  const base = (id, extra) => ({ id, company: 'Company ' + id, role: 'Engineering Manager', stage: 'reviewing', location: 'London', salary: '',
    jobDescription: 'A synthetic description long enough for the workspace to show it.', hasDescription: true, notes: '', instructions: '',
    createdAt: '2026-10-20T10:00:00Z', sourceUrl: 'https://example.com/jobs/' + id, score: 78, scoreBreakdown: {}, fitReportId: 'fit-' + id, questions: [],
    hasCoverLetter: false, hasBrief: false, applicationCv: { status: 'missing' }, postingCheck: null, interviewTimeline: [], ...extra });
  const gap = (id, kind, label, why, question, state = 'open') => ({ id, kind, label, why, question, state });
  const jobs = [
    base('ag1', { company: 'Agentic Works', role: 'Head of Platform', stage: 'new', fitReportId: '', score: 64,
      agentReview: { lean: 'ask', reason: 'Strong platform scope but the location is unclear.', question: 'Is a hybrid role in Manchester workable?', advanceProbability: 0.42, dropProbability: 0.31 } }),
    base('pc1', { company: 'Northwind Labs', role: 'Director of Engineering', score: 86, postingCheck: { status: 'checked', policy: 'p1', checkedAt: '2026-10-28T09:00:00Z', draftStatus: 'drafted',
      gaps: [gap('g1', 'salary', 'Salary range', 'The posting does not say what the role pays.', 'What is the salary range for this role?'),
        gap('g2', 'location', 'Office days', 'It says hybrid but not how many days are in the office.', 'How many days a week does the team work from the office?')],
      form: { source: 'greenhouse', url: 'https://boards.greenhouse.io/northwind/jobs/1', status: 'ready', questions: [
        { id: 'q1', text: 'Why do you want to lead engineering at Northwind?', required: true, options: [], answerDraft: 'I want to build a platform team that ships calmly.', needsYou: false, reason: '', state: 'drafted' },
        { id: 'q2', text: 'What is your expected salary?', required: true, options: [], answerDraft: '', needsYou: true, reason: 'Salary expectations are personal.', state: 'pending' }] } } }),
    base('pc2', { company: 'Fabrikam Systems', role: 'VP Engineering', score: 81, postingCheck: { status: 'partial', policy: 'p1', checkedAt: '2026-10-28T08:00:00Z', draftStatus: '',
      gaps: [], form: { source: '', url: '', status: 'not-detected', questions: [] } } }),
    base('ap1', { company: 'Contoso Cloud', role: 'Engineering Director', stage: 'applied', score: 83, interviewTimeline: [
      { id: 't1', date: '2026-10-22', round: 'Recruiter screen', kind: 'phone', source: 'email', notes: 'Friendly. Asked about team size.', proposalId: 'pr0', createdAt: '2026-10-21T10:00:00Z', updatedAt: '2026-10-21T10:00:00Z' },
      { id: 't2', date: '2026-10-29T14:00:00Z', round: 'Hiring manager', kind: 'video', source: 'manual', notes: '', proposalId: '', createdAt: '2026-10-25T10:00:00Z', updatedAt: '2026-10-25T10:00:00Z' }] }),
    base('mv1', { company: 'Moved Co', role: 'Platform Lead', stage: 'reviewing', score: 79, agentReview: { lean: 'advance', advanceProbability: 0.9, dropProbability: 0.05, reason: 'Matches what you pick.', question: '', reviewedAt: '2026-10-28T07:00:00Z', autoMove: { stage: 'reviewing', at: '2026-10-28T07:05:00Z', overriddenAt: '' } } }),
    base('mv2', { company: 'Undone Co', role: 'Platform Lead', stage: 'reviewing', score: 70, agentReview: { lean: 'advance', advanceProbability: 0.9, dropProbability: 0.05, reason: '', question: '', reviewedAt: '2026-10-28T07:00:00Z', autoMove: { stage: 'reviewing', at: '2026-10-28T07:05:00Z', overriddenAt: '2026-10-28T09:00:00Z' } } }),
    base('ap2', { company: 'Adventure Works', role: 'Head of Engineering', stage: 'new', score: 74, fitReportId: '' }),
  ];
  const applied = new Set();
  const rules = [{ id: 'r1', text: 'Prefers hybrid roles in London.', state: 'accepted' }, { id: 'r2', text: 'Original wording.', editedText: 'Avoids agencies and consultancies.', state: 'accepted' }];
  const needsItems = () => [
    { id: 'ag1', company: 'Agentic Works', role: 'Head of Platform', score: 64, location: 'Manchester', lean: 'ask', reason: 'Strong platform scope but the location is unclear.', question: 'Is a hybrid role in Manchester workable?', reviewedAt: '2026-10-28T07:00:00Z' },
    ...['pc1'].map(id => { const j = jobs.find(x => x.id === id); return { kind: 'posting-gaps', id, company: j.company, role: j.role, score: j.score, location: j.location, checkedAt: j.postingCheck.checkedAt,
      gaps: j.postingCheck.gaps.filter(g => g.state === 'open').map(({ state, ...g }) => g) }; }),
    ...['pc1'].map(id => { const j = jobs.find(x => x.id === id); return { kind: 'application-answers', id, company: j.company, role: j.role, score: j.score, location: j.location, checkedAt: j.postingCheck.checkedAt, source: 'greenhouse',
      questions: j.postingCheck.form.questions.filter(q => q.state === 'drafted' || (q.state === 'pending' && q.needsYou)).map(({ state, ...q }) => q) }; }),
    { kind: 'status-proposal', id: 'pr1', jobId: 'ap1', company: 'Contoso Cloud', role: 'Engineering Director', stage: 'applied', proposedStage: 'interviewing',
      summary: 'Contoso invited you to a final round with the VP of Product.', interview: { date: '2026-11-03T15:00:00Z', round: 'Final round', kind: 'video', notes: '' }, confidence: 0.92, matchedBy: 'thread',
      email: { subject: 'Final round invitation', from: 'recruiter@contoso.example', date: '2026-10-28T08:30:00Z', link: 'https://mail.google.com/mail/u/0/#all/thread1' }, createdAt: '2026-10-28T08:45:00Z' },
    { kind: 'status-proposal', id: 'pr2', jobId: 'ap2', company: 'Adventure Works', role: 'Head of Engineering', stage: 'new', proposedStage: 'reviewing',
      summary: 'Adventure Works asked for your CV and a short call.', interview: null, confidence: 0.7, matchedBy: 'sender',
      email: { subject: 'Next steps', from: 'talent@adventure.example', date: '2026-10-27T12:00:00Z', link: 'https://mail.google.com/mail/u/0/#all/thread2' }, createdAt: '2026-10-27T12:30:00Z' },
    { kind: 'preference-proposal', id: 'pf1', text: 'Drops roles that need weekly travel.', sourceDecisionIds: ['d1', 'd2'], createdAt: '2026-10-28T06:00:00Z',
      sources: [{ id: 'd1', jobId: 'ap2', company: 'Adventure Works', role: 'Head of Engineering', direction: 'drop' }, { id: 'd2', jobId: 'pc2', company: 'Fabrikam Systems', role: 'VP Engineering', direction: 'drop' }] },
  ].filter(item => !applied.has(item.id));
  const calls = [];
  const clone = value => JSON.parse(JSON.stringify(value));
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), body = request.postDataJSON();
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (url.pathname !== '/api/admin/jobs') return reply({ error: 'Unexpected fixture request' }, 404);
    if (request.method() === 'GET') {
      if (url.searchParams.get('needsYou') === '1') return reply({ items: needsItems(), agreement: { decided: 9, agreed: 7, rate: 0.78 } });
      if (url.searchParams.get('preferences') === '1') return reply({ rules: clone(rules), lastLearnedAt: '2026-10-27T09:00:00Z' });
      if (url.searchParams.get('reviewReasons') === '1') return reply({ advance: [], drop: [] });
      if (url.searchParams.get('activity') === '1') return reply({ events: [], hasMore: false, snapshot: 1, stats: {}, usage: { days: [], breakdown: [] } });
      if (url.searchParams.has('id')) { const job = jobs.find(j => j.id === url.searchParams.get('id')); return job ? reply({ job: clone(job) }) : reply({ error: 'Job not found' }, 404); }
      return reply({ jobs: clone(jobs), stages: ['new', 'reviewing', 'applied', 'interviewing', 'offer', 'rejected', 'not_interested', 'expired'], archiveOnStage: ['rejected', 'not_interested', 'expired'],
        archivedCount: 0, features: { jevEnabled: true }, needsYouCount: needsItems().length });
    }
    if (request.method() !== 'POST') return reply({ error: 'Unexpected fixture request' }, 404);
    calls.push(body);
    if (body.action === 'accept-preference' || body.action === 'reject-preference' || body.action === 'edit-preference') {
      applied.add(body.id);
      if (body.action !== 'reject-preference') rules.push({ id: body.id, text: 'Drops roles that need weekly travel.', editedText: body.text, state: 'accepted' });
      return reply({ rule: { id: body.id } });
    }
    if (body.action === 'delete-preference') { rules.splice(rules.findIndex(r => r.id === body.id), 1); return reply({ deleted: body.id }); }
    const job = jobs.find(j => j.id === body.id), pc = job?.postingCheck;
    const out = () => reply({ job: clone(job) });
    switch (body.action) {
      case 'dismiss-gap': pc.gaps.find(g => g.id === body.gapId).state = 'dismissed'; return out();
      case 'draft-gap-question': Object.assign(pc.gaps.find(g => g.id === body.gapId), { state: 'asked', question: body.question }); return out();
      case 'approve-answer': Object.assign(pc.form.questions.find(q => q.id === body.questionId), { state: 'approved', answerDraft: body.answer }); return out();
      case 'skip-answer': pc.form.questions.find(q => q.id === body.questionId).state = 'skipped'; return out();
      case 'paste-questions': pc.form = { source: 'pasted', url: '', status: 'ready', questions: body.text.split('\n').filter(Boolean).map((text, i) => ({ id: 'pq' + i, text: text.replace(/\*$/, ''), required: text.endsWith('*'), options: [], answerDraft: '', needsYou: false, reason: '', state: 'pending' })) };
        return reply({ job: clone(job), requested: true });
      case 'rerun-posting-check': return reply({ requested: true, runId: 'run_1' }, 202);
      case 'apply-proposal': { const item = needsItems().find(i => i.id === body.id); const target = jobs.find(j => j.id === item.jobId); target.stage = item.proposedStage;
        if (item.interview) target.interviewTimeline.push({ id: 'tn', ...item.interview, source: 'email', proposalId: item.id, createdAt: '2026-10-28T09:00:00Z', updatedAt: '2026-10-28T09:00:00Z' });
        applied.add(body.id); return reply({ proposal: { id: body.id, state: 'applied' }, job: clone(target), generationErrors: [] }); }
      case 'dismiss-proposal': applied.add(body.id); return reply({ proposal: { id: body.id, state: 'dismissed' } });
      case 'timeline-add': job.interviewTimeline.push({ id: 'new' + job.interviewTimeline.length, ...body.entry, source: 'manual', proposalId: '', createdAt: '2026-10-28T10:00:00Z', updatedAt: '2026-10-28T10:00:00Z' });
        return reply({ id: job.id, revision: 'r', interviewTimeline: clone(job.interviewTimeline) });
      case 'timeline-edit': Object.assign(job.interviewTimeline.find(e => e.id === body.entryId), body.entry); return reply({ id: job.id, revision: 'r', interviewTimeline: clone(job.interviewTimeline) });
      case 'timeline-remove': job.interviewTimeline = job.interviewTimeline.filter(e => e.id !== body.entryId); return reply({ id: job.id, revision: 'r', interviewTimeline: clone(job.interviewTimeline) });
      default: return reply({ error: 'Unexpected fixture action' }, 404);
    }
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => { pageErrors.push(e.message); console.error(e.message); });
  return { context, page, calls, jobs, pageErrors };
}
const settle = page => page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
try {
  if (process.env.ADMIN_UX_NEEDS_CAPTURE) {
    // Screenshots of the synthetic Needs you fixture. ADMIN_UX_BASELINE serves public/admin.html from git instead.
    const dir = process.env.ADMIN_UX_NEEDS_CAPTURE, tag = process.env.ADMIN_UX_BASELINE ? 'before' : 'after';
    const fx = await needsFixture(browser);
    await fx.context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    const shot = async (name, url, size, fullPage = false, ready = '.role-header', scrollTo = '') => {
      await fx.page.setViewportSize(size);
      await fx.page.goto(origin + url);
      await fx.page.locator(ready).first().waitFor();
      await settle(fx.page);
      await fx.page.evaluate(() => document.fonts.ready);
      if (scrollTo) await fx.page.locator(scrollTo).first().evaluate(el => { const r = el.getBoundingClientRect(); window.scrollBy(0, r.top - 90); });
      await fx.page.screenshot({ path: dir + '/' + name, fullPage });
      console.log('captured ' + name);
    };
    await shot('needs-' + tag + '-desktop.png', '/admin.html?collection=needs', { width: 1440, height: 2150 }, false, '.pipeline-item, .needs-card');
    if (tag === 'after') {
      await shot('rules-after-desktop.png', '/admin.html?collection=needs', { width: 1440, height: 3000 }, false, '.learned-rules');
      await shot('rules-after-mobile.png', '/admin.html?collection=needs', { width: 390, height: 844 }, true, '.learned-rules');
      await shot('moved-badge-after-desktop.png', '/admin.html?job=mv1', { width: 1440, height: 1100 }, false, '.role-stage');
      await shot('needs-after-mobile.png', '/admin.html?collection=needs', { width: 390, height: 844 }, true, '.needs-card');
      await shot('posting-check-after-desktop.png', '/admin.html?job=pc1&section=materials', { width: 1440, height: 1900 }, false, '.posting-check');
      await shot('timeline-after-desktop.png', '/admin.html?job=ap1&section=overview', { width: 1440, height: 1700 }, false, '.interview-timeline');
      await shot('timeline-after-mobile.png', '/admin.html?job=ap1&section=overview', { width: 390, height: 844 }, true, '.interview-timeline');
    }
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    process.exit(0);
  }
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
    applicationFitUrl: i === 0 ? '/fit/personalised-job0' : undefined,
    applicationCv: i === 1 ? { status: 'missing' } : { publicId: 'personalised-job' + i, fitUrl: '/fit/personalised-job' + i,
      downloadUrl: '/fit/personalised-job' + i + '/cv.pdf', currentVersionId: 'cv-v2', submittedVersionId: i === 2 ? 'cv-v2' : undefined,
      status: i === 2 ? 'needs_review' : 'ready', stale: i === 0, createdAt: '2026-09-29T10:00:00Z' },
    hasResearch: i !== 1, researchStale: true, briefStale: true,
    questions: i ? [] : [{ id: 'q1', q: 'Why this role?', limit: 120, a: 'A synthetic saved answer.' }],
  }));
  if (process.env.ADMIN_UX_CV_SAVED_UNPUBLISHED) {
    jobs[0].applicationCv = { publicId: 'personalised-job0', currentVersionId: '', submittedVersionId: '', status: 'completed',
      latestVersionId: 'cv-v2', latestVersion: { id: 'cv-v2', createdAt: '2026-09-29T10:00:00Z', model: 'gpt-5.6-sol', hasPdf: true, validationStatus: 'valid' },
      run: { status: 'completed', publication: 'saved', versionId: 'cv-v2' } };
  } else if (process.env.ADMIN_UX_CV_GENERAL_FALLBACK) {
    jobs[0].applicationCv = { status: 'missing' };
    jobs[0].generalCv = { available: true, downloadUrl: '/bernardo-raposo-cv.pdf' };
  } else {
    jobs[3].applicationCv.status = 'failed';
    jobs[3].applicationCv.run = { status: 'failed', error: 'Synthetic update failed' };
    jobs[4].applicationCv = { publicId: 'personalised-job4', status: 'completed', currentVersionId: '', submittedVersionId: '',
      latestVersionId: 'cv-v2', latestVersion: { id: 'cv-v2', createdAt: '2026-09-29T10:00:00Z', model: 'gpt-5.6-sol', hasPdf: true, validationStatus: 'valid' },
      run: { status: 'completed', publication: 'saved', versionId: 'cv-v2' } };
    jobs[5].applicationCv = { status: 'missing' };
    jobs[5].generalCv = { available: true, downloadUrl: '/bernardo-raposo-cv.pdf' };
    jobs[6].generalCv = { available: true, downloadUrl: '/bernardo-raposo-cv.pdf' };
    jobs[7].applicationCv = { publicId: 'personalised-job7', status: 'completed', currentVersionId: '', submittedVersionId: '',
      latestVersionId: 'cv-v2', latestVersion: { id: 'cv-v2', createdAt: '2026-09-29T10:00:00Z', model: 'gpt-5.6-sol', hasPdf: true, validationStatus: 'valid' },
      run: { status: 'completed', publication: 'saved', versionId: 'cv-v2' } };
    jobs[7].generalCv = { available: true, downloadUrl: '/bernardo-raposo-cv.pdf' };
    jobs[8].applicationCv = { status: 'missing' };
    jobs[8].generalCv = { available: false };
  }
  jobs[1].jevStale = true;
  jobs[1].jevAssessment = { score: 79, assessedAt: '2026-09-20T10:00:00Z',
    dimensions: ['Responsibilities fit', 'Evidence of capability', 'Seniority and scope', 'Career direction', 'Practical compatibility']
      .map((label, i) => ({ label, score: 79 - i, id: ["responsibilities", "evidence", "scope", "direction", "practical"][i], weight: [30, 30, 15, 5, 20][i], confidence: 0.9 })) };
  let failSave = false, dispatches = 0, reviews = 0, mutations = 0, cvViewTokens = 0, cvViewVersionIds = [], jevRoutesModels = false;
  const errors = [];
  const page = await context.newPage();
  if (process.env.ADMIN_UX_CAPTURE_ONLY) {
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  }
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
      return reply({ jobs, stages: ['new', 'reviewing', 'interviewing', 'expired'], archiveOnStage: ['expired'], archivedCount: 0, features: { jevEnabled: true } });
    }
    if (url.pathname === '/api/admin/versions') {
      if (request.method() === 'POST') { mutations++; return reply({ok:true}); }
      if (url.searchParams.has('kind')) return reply({ content: { opening: 'Synthetic saved version content <script>unsafe()</script>' } });
      return reply(Object.fromEntries(['fit','letter','research','brief'].map(kind => [kind, [{vid:'v2',at:'2026-09-15T10:00:00Z',model:'gpt-5.6-sol',active:true,score:78},{vid:'v1',at:'2026-09-01',model:'claude-sonnet-5',active:false,score:88,versionInstructions:'Focus on team leadership <script>unsafe()</script>'}]])));
    }
    if (url.pathname === '/api/admin/cv') {
      const job = jobs.find(j => j.id === (body?.id || url.searchParams.get('id')));
      const versions = [{ versionId: 'cv-v2', createdAt: '2026-09-29T10:00:00Z', model: 'gpt-5.6-sol', hasPdf: true, validation: { status: 'valid' } },
        { versionId: 'cv-v1', createdAt: '2026-09-20T10:00:00Z', model: 'claude-sonnet-5', hasPdf: true, validation: { status: 'valid' } },
        { versionId: 'cv-v0', createdAt: '2026-09-12T10:00:00Z', model: 'gpt-5.6-sol', hasPdf: false, validation: { status: 'needs_review', issues: [{ code: 'missing_evidence', message: 'Add evidence for the required platform leadership experience.' }] } }];
      const cvVersions = process.env.ADMIN_UX_CV_SAVED_UNPUBLISHED ? versions.slice(0, 1) : versions;
      if (request.method() === 'POST' && body.action === 'view-token') { cvViewTokens++; cvViewVersionIds.push(body.versionId); return reply({ previewUrl: '/private/cv-preview?token=fixture', downloadUrl: '/private/cv-download?token=fixture' }); }
      if (request.method() === 'POST' && body.action === 'publish') { mutations++; job.applicationCv.currentVersionId = body.versionId; return reply({ job }); }
      if (url.searchParams.has('version')) return reply({ version: cvVersions.find(version => version.versionId === url.searchParams.get('version')), validation: cvVersions.find(version => version.versionId === url.searchParams.get('version'))?.validation, content: { identity: { name: 'Synthetic Candidate', privateKey: 'never show keys' }, summary: 'A synthetic CV preview.', experience: [{ roleId: 'internal-role-id', title: 'Engineering Manager', company: 'Example company', dates: '2021–2025', bullets: [{ text: 'Led a synthetic team.', evidenceIds: ['internal-evidence-id'] }] }] } });
      return reply({ application: job?.applicationCv || { status: 'missing' }, versions: job?.applicationCv?.currentVersionId || job?.applicationCv?.latestVersionId ? cvVersions : [] });
    }
    if (url.pathname === '/api/admin/reports') return reply({ days: [], breakdown: [] });
    if (url.pathname === '/api/admin/cover' && body?.action === 'review') {
      reviews++;
      return reply({ review: { effectiveKind: body.kind, fingerprint: 'fixture-reviewed', model: body.kind === 'jev-score' ? 'jev-1.13.0' : body.model || 'gpt-6.1-sol',
        routing: jevRoutesModels ? { source: 'jev', reason: 'Standard synthesis uses balanced Sol.' } : null,
        submitLabel: 'Generate analysis', description: body.kind === 'cv' ? 'We’ll tailor a CV to this role using your experience.' : 'We’ll write a cover letter tailored to this role and your experience.', inputSummary: 'Saved fixture inputs',
        publication: 'Becomes active', costText: 'Estimate unavailable. May incur costs.' } });
    }
    if (url.pathname === '/api/admin/cover' && request.method() === 'POST') {
      dispatches++; check('dispatch carries reviewed fingerprint', body.reviewFingerprint === 'fixture-reviewed');
      return reply({ error: 'Synthetic dispatch failure' }, 503);
    }
    return reply({ error: 'Unexpected fixture request' }, 404);
  });
  await page.goto(origin + '/admin.html?job=job0');
  if (process.env.ADMIN_UX_CAPTURE_ONLY) {
    await page.locator('[data-section="materials"]').click();
    await page.locator('#panel-materials').waitFor();
    if (process.env.ADMIN_UX_CV_SAVED_UNPUBLISHED) {
      await page.locator('[data-document="cv"] [data-act="cvversions-toggle"]').click();
      await page.locator('[data-document="cv"] [data-cv-version="cv-v2"]').waitFor();
      if (!process.env.ADMIN_UX_BASELINE) {
        assert.match(await page.locator('[data-document="cv"] [data-summary="cv"]').textContent(), /Saved · not live/);
        assert.equal(await page.locator('[data-document="cv"] [data-act="cvopen"]').textContent(), 'Preview saved CV');
        assert.equal(await page.locator('[data-document="cv"] [data-act="cvdownload"]').textContent(), 'Download saved CV');
        assert.equal(await page.locator('[data-document="cv"] [data-act="cvpublish"]').count(), 1);
      }
    }
    if (process.env.ADMIN_UX_CV_GENERAL_FALLBACK && !process.env.ADMIN_UX_BASELINE) {
      assert.equal((await page.locator('[data-document="cv"] [data-summary="cv"]').textContent()).trim(), 'Fit analysis only · no tailored CV yet');
      assert.equal(await page.locator('[data-document="cv"] [data-act="generalcvdownload"]').getAttribute('href'), '/bernardo-raposo-cv.pdf');
      assert.equal(await page.locator('[data-document="cv"] [data-act="appgenerate"]').textContent(), 'Generate new version');
      assert.equal(await page.locator('[data-document="cv"] [data-act="cvopen"]').count(), 0);
      assert.equal(await page.locator('[data-document="cv"] [data-act="cvdownload"]').count(), 0);
    }
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
    await page.evaluate(() => document.fonts.ready);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: process.env.ADMIN_UX_SCREENSHOTS + '/' + (process.env.ADMIN_UX_BASELINE ? 'before' : 'after') + '-admin-cv-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: process.env.ADMIN_UX_SCREENSHOTS + '/' + (process.env.ADMIN_UX_BASELINE ? 'before' : 'after') + '-admin-cv-mobile.png', fullPage: true });
    if (process.env.ADMIN_UX_CV_SAVED_UNPUBLISHED && !process.env.ADMIN_UX_BASELINE) {
      const tokenRequest = page.waitForResponse(response => response.url().includes('/api/admin/cv') && response.request().method() === 'POST');
      await page.locator('[data-document="cv"] [data-act="cvopen"]').click();
      const response = await tokenRequest;
      assert.equal(response.request().postDataJSON().versionId, 'cv-v2');
    }
    console.log('captured synthetic Documents fixture at desktop (1280×900) and mobile (390×844)');
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    process.exit(0);
  }
  const audit = async name => {
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    check(name + ' has no automated WCAG A/AA violations', result.violations.length === 0 ||
      (console.log(JSON.stringify(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), null, 2)), false));
  };
  check('pipeline controls use shadcn components', await page.locator('#search').getAttribute('data-slot') === 'input' &&
    await page.locator('#stagefilter').getAttribute('data-slot') === 'native-select');
  await page.getByRole('button', { name: 'Collapse pipeline sidebar' }).focus();
  await page.keyboard.press('Enter');
  check('desktop pipeline collapses and workspace expands', await page.locator('.admin-shell').evaluate(el =>
    el.classList.contains('pipeline-collapsed') && el.querySelector('.pipeline').getBoundingClientRect().width === 64 &&
    getComputedStyle(el.querySelector('.pipeline-list')).display === 'none' && el.querySelector('.workspace').getBoundingClientRect().width > 1000));
  check('toggle uses a secondary icon button', await page.locator('.pipeline-toggle').getAttribute('data-variant') === 'secondary' &&
    await page.locator('.pipeline-toggle svg').count() === 1);
  check('collapsed pipeline retains the selected role', await page.locator('.role-header').isVisible() && await page.locator('.pipeline-toggle').getAttribute('aria-expanded') === 'false');
  if (process.env.ADMIN_UX_SCREENSHOTS) await page.screenshot({ path: `${process.env.ADMIN_UX_SCREENSHOTS}/pipeline-collapsed.png` });
  await page.reload();
  check('collapsed pipeline survives reload', await page.getByRole('button', { name: 'Expand pipeline sidebar' }).isVisible());
  await page.getByRole('button', { name: 'Expand pipeline sidebar' }).click();
  check('pipeline expands with controls available', await page.locator('#search').isVisible() && await page.locator('.pipeline-toggle').getAttribute('aria-expanded') === 'true');
  if (process.env.ADMIN_UX_SCREENSHOTS) await page.screenshot({ path: `${process.env.ADMIN_UX_SCREENSHOTS}/pipeline-expanded.png` });
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
  check('five unassessed shadcn gauges', await page.getByRole('meter').count() === 0 && await page.locator('.score-gauge[data-slot="card"]').count() === 5);
  check('legacy scores are not presented as current dimensions', await page.getByRole('img', {name:'Responsibilities: not assessed',exact:true}).count() === 1);
  for (const label of ['Responsibilities', 'Capability', 'Scope', 'Direction', 'Compatibility']) {
    const trigger = page.getByRole('button', { name: 'About ' + label, exact: true });
    check(label + ' help trigger is icon-only', (await trigger.textContent()).trim() === '');
    await trigger.hover();
    const help = page.locator('.dimension-help-content');
    await help.waitFor();
    check(label + ' explanation opens on hover', await page.getByRole('tooltip').count() === 1);
    await page.mouse.move(0, 0, { steps: 10 });
    await help.waitFor({ state: 'hidden' });
    await trigger.focus();
    await help.waitFor();
    check(label + ' has an accessible explanation', (await help.textContent()).length > 40);
    await page.keyboard.press('Escape');
    await help.waitFor({ state: 'hidden' });
    check(label + ' explanation returns keyboard focus', await trigger.evaluate(el => el === document.activeElement));
  }
  check('reading dimension help does not generate', dispatches === 0);
  const touchSession = await context.newCDPSession(page);
  try {
    await page.setViewportSize({ width: 390, height: 900 });
    await touchSession.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const tap = async locator => {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
      await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const trigger = page.getByRole('button', { name: 'About Compatibility', exact: true });
    const help = page.locator('.dimension-help-content');
    await tap(trigger);
    await help.waitFor();
    check('info icon opens a tooltip on touch', await page.getByRole('tooltip').count() === 1);
    await tap(trigger);
    await help.waitFor({ state: 'hidden' });
    check('second tap dismisses dimension help', await help.count() === 0);
    await tap(trigger);
    await help.waitFor();
    await tap(page.locator('.score-gauge').last().locator('p'));
    await help.waitFor({ state: 'hidden' });
    check('outside tap dismisses dimension help without generation', dispatches === 0);
  } finally {
    await touchSession.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await touchSession.detach();
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  check('Overview has no analytics or activity shortcut', await page.locator('#panel-overview .stats, #panel-overview [data-section-link="activity"]').count() === 0);
  await audit('Overview');
  if(process.env.ADMIN_UX_SCREENSHOTS) await page.screenshot({path:process.env.ADMIN_UX_SCREENSHOTS+'/admin-gauges.png'});
  await page.locator('[data-section="activity"]').click();
  await page.locator('.job-usage table').waitFor();
  check('Activity order is analytics, audit, inline usage', (await page.locator('[data-job-activity] h2').allTextContents()).join('|') === 'Analytics summary|Audit log|AI activity & usage');
  check('audit shows exact timestamps and escaped details', await page.locator('.audit-log time').getAttribute('datetime') === '2026-09-18T11:00:00Z' && (await page.locator('.audit-log strong').getAttribute('title')).includes('<script>unsafe()</script>') && await page.locator('.audit-log script').count() === 0);
  await page.locator('[data-activity-more]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.audit-log li').length===2);
  check('older actions append below the latest', (await page.locator('.audit-log li strong').allTextContents()).join('|') === 'Status changed|Added to pipeline');
  check('job usage is inline shadcn table without a dialog', await page.locator('.job-usage [data-slot="table"]').count() === 1 && await page.locator('[role="dialog"]').count() === 0);
  check('audit rows are timestamp-first single lines', await page.locator('.audit-log li').evaluateAll(rows => rows.every(row => row.firstElementChild.tagName === 'TIME' && row.children.length === 2 && getComputedStyle(row.lastElementChild).whiteSpace === 'nowrap')));
  check('analytics summary has three columns', await page.locator('.engagement-summary').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length === 3));
  await audit('Activity');
  if(process.env.ADMIN_UX_SCREENSHOTS) await page.screenshot({path:process.env.ADMIN_UX_SCREENSHOTS+'/admin-activity.png',fullPage:true});
  for(const width of [390,360]) {
    await page.setViewportSize({width,height:900});
    check('analytics stays three columns at '+width, await page.locator('.engagement-summary').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length === 3));
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
  check('fit analysis and CV share one document card', await page.locator('[data-document="fit"]').count() === 0 &&
    (await page.locator('[data-document="cv"] h3').textContent()) === 'Fit page & CV');
  check('published CV remains live and directly openable', /live/i.test(await page.locator('[data-document="cv"] [data-summary="cv"]').textContent()) &&
    await page.locator('[data-document="cv"] [data-act="cvopen"]').isVisible());
  await page.locator('[data-select-job="job4"]').click();
  await page.locator('[data-section="materials"]').click();
  check('saved unpublished CV is clearly labelled and directly previewable/downloadable',
    (await page.locator('[data-document="cv"] [data-summary="cv"]').textContent()).includes('Saved · not live') &&
    await page.locator('[data-document="cv"] [data-act="cvopen"]').getAttribute('data-version') === 'cv-v2' &&
    await page.locator('[data-document="cv"] [data-act="cvdownload"]').getAttribute('data-version') === 'cv-v2');
  await page.locator('[data-select-job="job3"]').click();
  await page.locator('[data-section="materials"]').click();
  check('failed update keeps the previous public CV reachable', (await page.locator('[data-document="cv"] [data-summary="cv"]').textContent()).includes('Last update failed · current version stays live') &&
    await page.locator('[data-document="cv"] [data-act="cvopen"]').isVisible());
  await page.locator('[data-select-job="job2"]').click();
  await page.locator('[data-section="materials"]').click();
  check('an old review state is not shown as a gate', !/needs review|review before/i.test(await page.locator('[data-document="cv"]').textContent()) &&
    await page.locator('[data-document="cv"] [data-act="cvopen"]').isVisible());
  await page.locator('[data-select-job="job5"]').click();
  await page.locator('[data-section="materials"]').click();
  check('general CV is clearly separate from job-specific generation', (await page.locator('[data-document="cv"] [data-summary="cv"]').textContent()).includes('no tailored CV yet') &&
    await page.locator('[data-document="cv"] [data-act="generalcvdownload"]').getAttribute('href') === '/bernardo-raposo-cv.pdf' &&
    await page.locator('[data-document="cv"] [data-act="appgenerate"]').textContent() === 'Generate new version');
  await page.locator('[data-select-job="job6"]').click();
  await page.locator('[data-section="materials"]').click();
  check('general CV fallback stays hidden when a tailored CV is live', await page.locator('[data-document="cv"] [data-act="cvopen"]').isVisible() &&
    await page.locator('[data-document="cv"] [data-act="generalcvdownload"]').count() === 0);
  await page.locator('[data-select-job="job7"]').click();
  await page.locator('[data-section="materials"]').click();
  check('general CV fallback stays hidden for a valid saved tailored CV', await page.locator('[data-document="cv"] [data-act="cvopen"]').getAttribute('data-version') === 'cv-v2' &&
    await page.locator('[data-document="cv"] [data-act="generalcvdownload"]').count() === 0);
  await page.locator('[data-select-job="job8"]').click();
  await page.locator('[data-section="materials"]').click();
  check('general CV fallback is omitted when the general file is unavailable', await page.locator('[data-document="cv"] [data-act="appgenerate"]').isVisible() &&
    await page.locator('[data-document="cv"] [data-act="generalcvdownload"]').count() === 0);
  await page.locator('[data-select-job="job0"]').click();
  await page.locator('[data-section="materials"]').click();
  await page.locator('[data-document="letter"] .version-summary').waitFor();
  check('fit page prefers the application-specific public link', await page.locator('[data-document="cv"] a.read-link').first().getAttribute('href') === '/fit/personalised-job0');
  check('fit page and CV have open, download and one generate action', await page.locator('[data-document="cv"] [data-act="cvopen"]').isVisible() &&
    await page.locator('[data-document="cv"] [data-act="cvdownload"]').isVisible() && await page.locator('[data-document="cv"] [data-act="appgenerate"]').count() === 1);
  check('CV and letter are separate with no combined action', await page.locator('[data-act="lettercv"]').count() === 0 && await page.locator('[data-document="letter"] [data-act="letteropen"]').isVisible());
  check('live version model and created time shown', (await page.locator('[data-document="letter"] .document-summary').textContent()).includes('Sol'));
  check('saved-document regeneration uses the outline button', await page.locator('[data-document="letter"] [data-act="cover"]').getAttribute('data-variant') === 'outline');
  check('versions use shadcn Collapsible', await page.locator('[data-slot="collapsible"]').count() === 4 &&
    await page.locator('[data-document="cv"] [data-slot="collapsible-trigger"]').count() === 1);
  await page.locator('[data-document="cv"] [data-act="cvversions-toggle"]').click();
  await page.locator('[data-document="cv"] [data-act="cvpreview"]').first().waitFor();
  await page.locator('[data-document="cv"] [data-act="cvpreview"]').first().click();
  await page.locator('[data-document="cv"] .vpreview').getByText('A synthetic CV preview.').waitFor();
  check('CV version preview is authenticated, escaped and omits internal identifiers', await page.locator('[data-document="cv"] .vpreview script').count() === 0 &&
    (await page.locator('[data-document="cv"] .vpreview').first().textContent()).includes('Led a synthetic team.') &&
    !(await page.locator('[data-document="cv"] .vpreview').first().textContent()).includes('internal-role-id') &&
    !(await page.locator('[data-document="cv"] .vpreview').first().textContent()).includes('never show keys'));
  check('unusable review drafts are not listed as versions', await page.locator('[data-document="cv"] [data-cv-version="cv-v0"]').count() === 0 &&
    await page.locator('[data-document="cv"] .cv-review-needed').count() === 0);
  await page.locator('[data-document="cv"] [data-act="cvversion-download"]').last().waitFor();
  check('valid historical versions have a separate download action', await page.locator('[data-document="cv"] [data-act="cvversion-download"]').count() === 2);
  if (process.env.ADMIN_UX_SCREENSHOTS) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: process.env.ADMIN_UX_SCREENSHOTS + '/after-admin-cv-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: process.env.ADMIN_UX_SCREENSHOTS + '/after-admin-cv-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  await Promise.all([page.waitForResponse(response => response.url().includes('/api/admin/cv') && response.request().method() === 'POST' && response.request().postDataJSON()?.versionId === 'cv-v1'),
    page.locator('[data-act="cvversion-download"][data-version="cv-v1"]').click()]);
  check('historical CV download requests the selected saved version', cvViewTokens === 1);
  await Promise.all([page.waitForResponse(response => response.url().includes('/api/admin/cv') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'view-token'), page.locator('[data-act="cvopen"]').click()]);
  await Promise.all([page.waitForResponse(response => response.url().includes('/api/admin/cv') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'view-token'), page.locator('[data-act="cvdownload"]').click()]);
  check('Open CV and Download CV use authenticated version links', cvViewTokens === 3);
  const mutationsBeforePublish = mutations;
  await Promise.all([page.waitForResponse(response => response.url().includes('/api/admin/cv') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'publish'),
    page.locator('[data-document="cv"] [data-act="cvpublish"]').first().click()]);
  check('publishing a previous CV version requires an explicit action', mutations === mutationsBeforePublish + 1);
  await audit('Documents');
  await page.locator('[data-act="letteropen"]').click();
  await page.locator('[data-act="briefopen"]').click();
  await page.locator('[data-act="researchopen"]').click();
  check('opening stale outputs dispatches nothing', dispatches === 0 && reviews === 0);
  await page.locator('[data-act="cover"]').click();
  await page.locator('[data-review-submit]:enabled').waitFor();
  check('review uses the shadcn Dialog', await page.locator('[role="dialog"]').getAttribute('data-slot') === 'dialog-content');
  check('dialog removes verbose copy below model', await page.locator('[data-review-body]').textContent().then(t => !t.includes('Output and versions') && !t.includes('Cost estimate unavailable')));
  check('review explains the result in a natural paragraph', await page.locator('.review-description').textContent() === 'We’ll write a cover letter tailored to this role and your experience.' && await page.locator('[data-review-body] ol').count() === 0 && !(await page.locator('[data-review-body]').textContent()).includes('Work to run'));
  await page.locator('[data-version-instructions]').fill('Highlight mentoring and platform ownership');
  await page.locator('[data-review-submit]:enabled').waitFor();
  await page.locator('[data-review-model]').selectOption('claude-sonnet-5-5');
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
  check('a new role offers one combined generation', await page.locator('[data-document="cv"] [data-act="appgenerate"]').textContent() === 'Generate fit page & CV');
  await page.locator('[data-act="appgenerate"]').click();
  await page.locator('[data-review-submit]:enabled').waitFor();
  check('application review has one instructions field for both documents', await page.locator('[data-version-instructions]').count() === 1 &&
    /fit analysis and the CV/.test(await page.locator('[data-version-instructions]').getAttribute('placeholder')) &&
    await page.locator('[data-review-model]').count() === 0);
  await page.locator('[data-review-submit]:enabled').click();
  await page.getByRole('alert').filter({ hasText: 'Synthetic dispatch failure' }).waitFor();
  check('explicit submission dispatches once', dispatches === 1);
  await page.keyboard.press('Escape');
  await page.locator('[data-select-job="job0"]').click();
  for (const width of [1280, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    if (width <= 900) check('desktop collapse control is hidden on mobile at ' + width, !(await page.locator('.pipeline-toggle').isVisible()));
    check('CV open and download actions fit at ' + width, await page.locator('[data-document="cv"] [data-act="cvopen"]').isVisible() && await page.locator('[data-document="cv"] [data-act="cvdownload"]').isVisible());
    check('combined CV and letter action stays removed at ' + width, await page.locator('[data-act="lettercv"]').count() === 0);
    check('document actions use single-line labels and a separate regeneration row at ' + width, await page.evaluate(() => {
      return [...document.querySelectorAll('.material-row[data-document]')].every(card => {
        const actions = [...card.querySelectorAll('.material-actions > [data-slot="button"]')];
        if (actions.some(button => button.scrollWidth > button.clientWidth + 1)) return false;
        const generation = actions.find(button => button.classList.contains('generation'));
        const opens = actions.filter(button => !button.classList.contains('generation'));
        return !generation || !opens.length || opens.every(button => button.getBoundingClientRect().bottom < generation.getBoundingClientRect().top);
      });
    }));
    check('no horizontal overflow at ' + width, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (width === 390) await audit('Mobile materials');
    if (process.env.ADMIN_UX_SCREENSHOTS) await page.screenshot({ path: `${process.env.ADMIN_UX_SCREENSHOTS}/admin-${width}.png`, fullPage: true });
  }
  await page.locator('[data-act="back"]').click();
  check('mobile back shows pipeline', await page.locator('.pipeline').isVisible());
  jobs[0].jevAssessment = { assessedAt: '2026-09-19T12:00:00Z', score: 73, provisional: true,
    dimensions: ['Responsibilities fit', 'Evidence of capability', 'Seniority and scope', 'Career direction', 'Practical compatibility'].map((label, i) => ({ label, score: i === 4 ? 50 : 75, weight: [25,25,20,20,10][i], confidence: i === 4 ? 0.59 : 0.9 })),
    posting: { choice: 'partial' }, constraint: { choice: 'unknown' } };
  jobs[0].score = 73;
  jobs[0].overviewSummary = {assessedAt: jobs[0].jevAssessment.assessedAt, position: 'Lead the engineering team building a content platform. Partner with product and design on developer workflows.', fit: 'Leadership and developer experience align well. Confirm travel expectations before proceeding; practical compatibility is the main trade-off.'};
  await page.goto(origin + '/admin.html?job=job0');
  await page.locator('[data-act="jevscore"]').waitFor();
  check('saved overview summary is visible', await page.locator('.overview-summary').textContent().then(t => t.includes('Lead the engineering team') && t.includes('Confirm travel expectations')));
  check('Overview is free of shortcuts and cost legends', await page.locator('.overview-actions, .generation-legend').count() === 0 && !(await page.locator('#panel-overview').textContent()).includes('Jev'));
  check('Assess fit has an AI icon and neutral label', await page.locator('[data-act="jevscore"] svg').count() === 1 && (await page.locator('[data-act="jevscore"]').textContent()).trim() === 'Assess fit');
  check('five Jev dimensions render', await page.locator('.score-gauge').count() === 5);
  check('repeated evidence explanation is absent', await page.locator('.dimension-warning').count() === 0);
  check('lower confidence retains the saved practical score', await page.getByRole('meter', { name: 'Compatibility', exact: true }).getAttribute('aria-valuenow') === '50');
  check('confidence remains visible', await page.getByText('Model confidence: 90%', {exact:true}).count() === 4);
  check('lower confidence has a visible review cue', await page.locator('.assessment-confidence-warning').count() === 1 &&
    await page.locator('.assessment-confidence-warning').textContent().then(t => t.includes('Model confidence: 59%') && t.includes('Review rating')));
  check('posting warnings avoid invented dimension gaps', await page.locator('#panel-overview .assessment-warning').textContent().then(t => t.includes('Review the job description') && t.includes('The job description has too little detail') && !t.includes('Travel and working arrangements')));
  check('pipeline shows a compact accessible warning', await page.locator('[data-select-job="job0"] .assessment-status').getAttribute('aria-label') === 'Provisional score; see Fit assessment for details' && await page.locator('[data-select-job="job0"] .assessment-status').textContent() === '⚠');
  check('role header shows a compact accessible warning', await page.locator('.role-header .assessment-status').getAttribute('aria-label') === 'Provisional score; see Fit assessment for details' && await page.locator('.role-header .assessment-status').textContent() === '⚠');
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    check('five dimensions and warnings fit at ' + width, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.ADMIN_UX_SCREENSHOTS) {
      await page.screenshot({ path: process.env.ADMIN_UX_SCREENSHOTS + '/jev-' + width + '.png', fullPage: true });
      if (width === 1280) {
        await page.locator('.overview-summary').scrollIntoViewIfNeeded();
        await page.screenshot({ path: process.env.ADMIN_UX_SCREENSHOTS + '/overview-summary-desktop.png' });
      }
    }
  }
  await page.setViewportSize({ width: 360, height: 900 });
  await audit('Jev assessment mobile');
  const writingModel = await page.evaluate(() => localStorage.getItem('fit.model'));
  await page.locator('[data-act="jevscore"]').click();
  await page.locator('[data-review-submit]:enabled').waitFor();
  check('Jev review has a fixed model', await page.locator('[data-review-model]').count() === 0);
  check('Jev preserves writing-model preference', await page.evaluate(() => localStorage.getItem('fit.model')) === writingModel);
  await audit('Jev review');
  await page.keyboard.press('Escape');
  jevRoutesModels = true;
  await page.goto(origin + '/admin.html?job=job1');
  await page.locator('[data-section="materials"]').waitFor();
  await page.locator('[data-section="materials"]').click();
  await page.locator('[data-act="appgenerate"]').click();
  await page.locator('[data-review-submit]:enabled').waitFor();
  check('automatic writing routing stays behind the scenes', !(await page.locator('[role="dialog"]').textContent()).includes('Jev'));
  check('Jev selected writer is fixed in review', await page.locator('[data-review-model]').count() === 0);
  await audit('Jev model selection');
  await page.keyboard.press('Escape');
  const beforeNotice = { dispatches, mutations };
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + '/admin.html?job=job0&stage=interviewing');
    const notice = page.locator('.workspace > .notice');
    await notice.waitFor();
    check('filtered-out notice uses the content column at ' + width, await notice.evaluate(el => {
      const description = el.querySelector('[data-slot="alert-description"]');
      if (!description) return false;
      const range = document.createRange();
      range.selectNodeContents(description.firstChild);
      return description.getBoundingClientRect().width > el.getBoundingClientRect().width * 0.8 &&
        range.getBoundingClientRect().height < 70 && el.getBoundingClientRect().height < 150;
    }));
    check('filtered-out role stays open at ' + width, await page.locator('.role-header').isVisible());
    check('notice stays within the viewport at ' + width, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await audit('Filtered-out role ' + width);
    if (process.env.ADMIN_UX_SCREENSHOTS) await page.screenshot({ path: process.env.ADMIN_UX_SCREENSHOTS + '/notice-' + width + '.png' });
    await notice.getByRole('button', { name: 'Return to the list' }).click();
    check('notice return action restores the list at ' + width, await page.locator('.pipeline').isVisible() && await page.locator('.workspace > .notice').count() === 0);
  }
  check('notice navigation does not generate or mutate', dispatches === beforeNotice.dispatches && mutations === beforeNotice.mutations);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + '/admin.html?job=job1');
    await page.locator('.role-header .score-tile').waitFor();
    check('outdated saved score remains visible in role header at ' + width,
      await page.locator('.role-header .score-tile').textContent() === '79' &&
      (await page.locator('.role-header .score-tile').getAttribute('aria-label')).includes('outdated assessment'));
    check('outdated saved dimensions remain visible at ' + width,
      await page.getByRole('meter').count() === 5 &&
      await page.getByRole('meter', { name: 'Responsibilities' }).getAttribute('aria-valuenow') === '79' &&
      (await page.locator('#panel-overview').textContent()).includes('Outdated'));
    if (width === 390) await page.locator('[data-act="back"]').click();
    check('outdated saved score remains visible in pipeline at ' + width,
      await page.locator('[data-select-job="job1"] .score-tile').textContent() === '79' &&
      (await page.locator('[data-select-job="job1"] .score-tile').getAttribute('aria-label')).includes('outdated assessment'));
    check('outdated score layout fits at ' + width,
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.ADMIN_UX_SCREENSHOTS) await page.screenshot({ path: process.env.ADMIN_UX_SCREENSHOTS + '/outdated-score-' + width + '.png' });
  }
  {
    // Desktop Pipeline board: columns replace the stage dropdown; mobile keeps the list.
    const { BOARD_COLUMNS, groupByColumn } = await import('../public/pipeline-board.js');
    jobs[2].stage = jobs[3].stage = jobs[4].stage = jobs[5].stage = 'reviewing'; // 2 and 3 have a fit page and live CV
    jobs[6].cvRun = { runId: 'cv-run-6', status: 'running' };
    const expected = groupByColumn(jobs.filter(job => !['expired'].includes(job.stage)));
    const boardPage = await context.newPage();
    boardPage.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
    await boardPage.setViewportSize({ width: 1280, height: 800 });
    await boardPage.goto(origin + '/admin.html');
    await boardPage.evaluate(() => localStorage.removeItem('fit.pipeline.view'));
    await boardPage.reload();
    await boardPage.locator('.pipeline-item').first().waitFor();
    const box = selector => boardPage.locator(selector).first().evaluate(el => {
      const c = getComputedStyle(el), r = el.getBoundingClientRect();
      return { h: r.height, border: c.borderTopWidth + ' ' + c.borderTopColor, radius: c.borderTopLeftRadius, bg: c.backgroundColor, font: c.fontSize };
    });
    const [dropdown, sortBtn, listBtn, boardBtn] = [await box('#stagefilter'), await box('.sort-trigger'), await box('[data-view="list"]'), await box('[data-view="board"]')];
    check('view switch sits in the control row with a name and pressed state', await boardPage.locator('.pipeline-filter-row [role="group"][aria-label="Pipeline view"] button').count() === 2 &&
      await boardPage.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed') === 'true' &&
      await boardPage.getByRole('button', { name: 'Board view' }).getAttribute('aria-pressed') === 'false');
    check('view switch matches the sort button and dropdown box', [sortBtn, listBtn, boardBtn].every(b => b.h === dropdown.h && b.h === 44 && b.radius === dropdown.radius) &&
      boardBtn.border === dropdown.border && boardBtn.bg === dropdown.bg && boardBtn.font === dropdown.font); // the pressed List button differs only by its accent border and tint
    console.log('control sizes at 1280', JSON.stringify({ dropdown, sortBtn, listBtn, boardBtn }));
    await boardPage.getByRole('button', { name: 'Board view' }).click();
    await boardPage.locator('[data-board]').waitFor();
    check('board shows one labelled column per active stage', await boardPage.locator('[data-board-column]').count() === 6 &&
      (await boardPage.locator('[data-board-column] h2').allTextContents()).join('|') === 'New|Reviewing|Ready to apply|Applied|Interviewing|Offer' &&
      await boardPage.getByRole('region', { name: 'Ready to apply' }).count() === 1 && await boardPage.getByRole('list', { name: 'Ready to apply roles' }).count() === 1);
    for (const column of BOARD_COLUMNS) {
      const ids = expected[column.id].map(job => job.id).sort().join();
      check('board column ' + column.label + ' holds ' + expected[column.id].length + ' roles', await boardPage.locator('[data-board-column="' + column.id + '"]').evaluate(el =>
        el.querySelector('.board-count').textContent + '|' + [...el.querySelectorAll('[data-select-job]')].map(b => b.getAttribute('data-select-job')).sort().join()) === expected[column.id].length + '|' + ids);
    }
    check('ready to apply is derived from fit page and live CV', ['job2', 'job3'].every(id => expected.ready.some(job => job.id === id)) && ['job4', 'job5'].every(id => expected.reviewing.some(job => job.id === id)) &&
      !expected.ready.some(job => ['job4', 'job5'].includes(job.id)));
    check('column header names what is running', await boardPage.locator('[data-board-column="interviewing"] .board-activity').textContent() === '1 CV generating' &&
      await boardPage.locator('[data-board-column="offer"] .board-activity').count() === 0);
    check('board hides the stage dropdown and keeps search and sort', await boardPage.locator('#stagefilter').count() === 0 && await boardPage.locator('#search').isVisible() && await boardPage.locator('.sort-trigger').isVisible());
    check('board reuses the existing card and score tile', await boardPage.locator('[data-board] .pipeline-item .score-tile').count() > 5 && await boardPage.locator('[data-board] .pipeline-item').first().evaluate(el => el.tagName === 'BUTTON' && el.getAttribute('data-slot') === 'button'));
    check('empty columns show a quiet empty state', await boardPage.locator('[data-board-column="offer"] .board-empty').textContent() === 'Nothing here yet');
    check('board scrolls inside its area, not the page', await boardPage.evaluate(() => { const b = document.querySelector('[data-board]'); return b.scrollWidth > b.clientWidth && getComputedStyle(b).overflowX === 'auto' && document.documentElement.scrollWidth <= innerWidth; }));
    check('the choice is remembered on this browser', await boardPage.evaluate(() => localStorage.getItem('fit.pipeline.view')) === 'board');
    await boardPage.locator('#search').fill('company 2');
    await boardPage.locator('[data-board-column="ready"] [data-select-job="job3"]').waitFor({ state: 'detached' });
    check('search filters board cards', await boardPage.locator('[data-board-column="ready"] [data-select-job="job2"]').count() === 1);
    await boardPage.locator('#search').fill('');
    await boardPage.locator('[data-board-column="ready"] [data-select-job="job3"]').waitFor();
    await boardPage.locator('.sort-trigger').click();
    await boardPage.getByRole('button', { name: 'Lowest score' }).click();
    check('sort applies within columns', (await boardPage.locator('[data-board-column="interviewing"] .score-tile').allTextContents()).map(Number).every((n, i, all) => !i || all[i - 1] <= n));
    await boardPage.locator('.sort-trigger').click();
    await boardPage.getByRole('button', { name: 'Highest score' }).click();
    await boardPage.reload();
    await boardPage.locator('[data-board]').waitFor();
    check('board survives reload', await boardPage.getByRole('button', { name: 'Board view' }).getAttribute('aria-pressed') === 'true');
    await boardPage.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
    const boardAudit = await new AxeBuilder({ page: boardPage }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    check('board has no automated WCAG A/AA violations', boardAudit.violations.length === 0 || (console.log(JSON.stringify(boardAudit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })))), false));
    await boardPage.getByRole('button', { name: /Example company 3/ }).focus();
    await boardPage.keyboard.press('Enter');
    await boardPage.locator('.role-header').waitFor();
    check('selecting a card opens the existing workspace with the list', await boardPage.locator('[data-board]').count() === 0 && await boardPage.locator('.workspace .role-header').isVisible() &&
      await boardPage.locator('[data-select-job="job3"].selected').count() === 1 && new URL(boardPage.url()).searchParams.get('job') === 'job3');
    check('opened role leaves the saved board choice alone', await boardPage.evaluate(() => localStorage.getItem('fit.pipeline.view')) === 'board' && await boardPage.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed') === 'true');
    await boardPage.getByRole('button', { name: 'Board view' }).click();
    await boardPage.locator('[data-board]').waitFor();
    check('the switch returns from a role to the board', !new URL(boardPage.url()).searchParams.has('job') && await boardPage.locator('.workspace').count() === 0);
    await boardPage.goBack();
    await boardPage.locator('.workspace .role-header').waitFor();
    check('browser Back returns to the opened role', new URL(boardPage.url()).searchParams.get('job') === 'job3');
    await boardPage.getByRole('button', { name: 'Board view' }).click();
    await boardPage.setViewportSize({ width: 390, height: 844 });
    await boardPage.locator('#stagefilter').waitFor();
    check('mobile keeps the list with the stage dropdown and no switch', await boardPage.locator('[data-board]').count() === 0 && await boardPage.locator('[data-view]').count() === 0 && await boardPage.locator('#stagefilter').isVisible());
    const mobile = [await box('#stagefilter'), await box('.sort-trigger')];
    console.log('control sizes at 390', JSON.stringify(mobile));
    check('mobile page has no horizontal scroll', await boardPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await boardPage.setViewportSize({ width: 1280, height: 800 });
    await boardPage.locator('[data-board]').waitFor();
    check('returning to desktop brings the board back', await boardPage.locator('[data-view]').count() === 2);
    await boardPage.locator('[data-collection="archive"]').click();
    await boardPage.locator('#stagefilter').waitFor();
    check('Archive keeps the list and has no switch', await boardPage.locator('[data-board]').count() === 0 && await boardPage.locator('[data-view]').count() === 0);
    await boardPage.setViewportSize({ width: 1440, height: 900 });
    await boardPage.evaluate(() => localStorage.removeItem('fit.pipeline.view'));
    await boardPage.close();
  }
  {
    // Needs you cards, posting check section, paste questions and interview timeline (stubbed API).
    const fx = await needsFixture(browser);
    const { page: np, calls, jobs: nJobs } = fx;
    const last = () => calls[calls.length - 1];
    const box = (page, selector) => page.locator(selector).first().evaluate(el => { const c = getComputedStyle(el), r = el.getBoundingClientRect();
      return { h: Math.round(r.height), w: Math.round(r.width), radius: c.borderTopLeftRadius, border: c.borderTopWidth + ' ' + c.borderTopColor, bg: c.backgroundColor, font: c.fontSize }; });
    await np.goto(origin + '/admin.html?collection=needs');
    await np.locator('[data-needs-kind]').first().waitFor();
    check('Needs you counts every item kind', (await np.locator('[data-collection="needs"]').textContent()).includes('6'));
    check('review items without a kind still render as before', await np.locator('button.pipeline-item[data-select-job="ag1"]').count() === 1 &&
      (await np.locator('button.pipeline-item[data-select-job="ag1"]').textContent()).includes('Agent: unsure') &&
      (await np.locator('button.pipeline-item[data-select-job="ag1"]').textContent()).includes('Is a hybrid role in Manchester workable?'));
    check('each new kind renders its own card', (await np.locator('[data-needs-kind]').evaluateAll(els => els.map(el => el.getAttribute('data-needs-kind')))).join() === 'posting-gaps,application-answers,status-proposal,status-proposal,preference-proposal');
    check('posting gaps card lists label, why and suggested question', await np.locator('[data-needs-kind="posting-gaps"]').evaluate(el => ['Salary range', 'does not say what the role pays', 'What is the salary range for this role?'].every(t => el.textContent.includes(t))));
    await settle(np);
    // Measure new controls against the existing Agent recommendation card buttons (Overview) and Documents textarea.
    const sizes = { card: await box(np, '[data-needs-kind="posting-gaps"] [data-pc-act="ask"]'), cardGhost: await box(np, '[data-needs-kind="posting-gaps"] [data-pc-act="dismiss-gap"]'),
      answerArea: await box(np, '[data-needs-kind="application-answers"] textarea'), pipelineCard: await box(np, '.needs-card'), reviewCard: await box(np, 'button.pipeline-item[data-select-job="ag1"]') };
    const agentBtn = await box(np, '[data-agent-decide="advance"]'), agentGhost = await box(np, '[data-agent-decide="drop"]');
    check('Needs you cards share the review card box (border, radius, background)', sizes.pipelineCard.radius === sizes.reviewCard.radius && sizes.pipelineCard.border.split(' ')[0] === sizes.reviewCard.border.split(' ')[0] && sizes.pipelineCard.w === sizes.reviewCard.w);
    check('Needs you buttons match the Agent recommendation buttons', [sizes.card.h, sizes.cardGhost.h].every(h => h === agentBtn.h && h === 44) && sizes.card.radius === agentBtn.radius &&
      sizes.card.font === agentBtn.font && sizes.card.bg === agentBtn.bg && sizes.cardGhost.border === agentGhost.border && sizes.cardGhost.bg === agentGhost.bg);
    console.log('needs-you sizes at 1440', JSON.stringify({ ...sizes, agentBtn, agentGhost }));
    // Ask recruiter: edit, save, copy.
    await np.locator('[data-gap-item="g1"] [data-pc-act="ask"]').click();
    const ta = np.locator('[data-gap-item="g1"] textarea');
    check('Ask recruiter opens the suggested question for editing', await ta.inputValue() === 'What is the salary range for this role?');
    await ta.fill('Could you share the salary band for this role?');
    await np.locator('[data-gap-item="g1"] [data-pc-act="save-question"]').click();
    await np.locator('[data-gap-item="g1"] [data-pc-act="copy-question"]').waitFor();
    check('save sends draft-gap-question with the edited text', JSON.stringify(last()) === JSON.stringify({ action: 'draft-gap-question', id: 'pc1', gapId: 'g1', question: 'Could you share the salary band for this role?' }));
    await np.locator('[data-gap-item="g1"] [data-pc-act="copy-question"]').click();
    check('Copy puts the saved question on the clipboard', await np.evaluate(() => navigator.clipboard.readText()) === 'Could you share the salary band for this role?');
    check('a saved toast confirms nothing was sent', await np.getByText('Question saved').count() >= 1);
    await np.locator('[data-gap-item="g2"] [data-pc-act="dismiss-gap"]').click();
    await np.locator('[data-gap-item="g2"]').waitFor({ state: 'detached' });
    check('Dismiss sends dismiss-gap and removes the gap', JSON.stringify(last()) === JSON.stringify({ action: 'dismiss-gap', id: 'pc1', gapId: 'g2' }) && await np.locator('[data-gap-item="g1"]').count() === 1);
    // Application answers.
    check('needs-you reason shows for personal questions', (await np.locator('[data-answer-item="q2"]').textContent()).includes('Needs you: Salary expectations are personal.'));
    await np.locator('[data-answer-item="q1"] textarea').fill('I want to build calm, fast engineering teams.');
    await np.locator('[data-answer-item="q1"] [data-pc-act="approve-answer"]').click();
    await np.locator('[data-answer-item="q1"]').waitFor({ state: 'detached' });
    check('Approve sends the edited answer', JSON.stringify(last()) === JSON.stringify({ action: 'approve-answer', id: 'pc1', questionId: 'q1', answer: 'I want to build calm, fast engineering teams.' }));
    await np.locator('[data-answer-item="q2"] [data-pc-act="skip-answer"]').click();
    await np.locator('[data-needs-kind="application-answers"]').waitFor({ state: 'detached' });
    check('Skip sends skip-answer and the finished card leaves', JSON.stringify(last()) === JSON.stringify({ action: 'skip-answer', id: 'pc1', questionId: 'q2' }) &&
      (await np.locator('[data-collection="needs"]').textContent()).includes('4'));
    // Proposals.
    const pr1 = np.locator('[data-needs-id="pr1"]');
    check('proposal card shows summary, stage badges, email and interview', await pr1.evaluate(el => ['invited you to a final round', 'Applied', 'Interviewing', 'Final round invitation', 'recruiter@contoso.example', 'Final round'].every(t => el.textContent.includes(t))) &&
      await pr1.locator('a.read-link').getAttribute('href') === 'https://mail.google.com/mail/u/0/#all/thread1');
    await np.locator('[data-px-id="pr2"][data-px-act="apply"]').click();
    await np.getByRole('alertdialog').waitFor();
    check('a move to Reviewing confirms and names CV generation', (await np.getByRole('alertdialog').textContent()).includes('starts its fit page and tailored CV'));
    await np.getByRole('button', { name: 'Cancel' }).click();
    check('cancelling the confirmation sends nothing', calls.every(c => c.action !== 'apply-proposal'));
    await np.locator('[data-px-id="pr1"][data-px-act="apply"]').click();
    await pr1.waitFor({ state: 'detached' });
    check('Apply sends apply-proposal (no confirmation for a plain move)', JSON.stringify(last()) === JSON.stringify({ action: 'apply-proposal', id: 'pr1' }));
    check('apply shows a status toast', await np.getByText('Contoso Cloud moved to Interviewing.').count() >= 1);
    await np.locator('[data-px-id="pr2"][data-px-act="apply"]').click();
    await np.getByRole('alertdialog').getByRole('button', { name: 'Move to Reviewing' }).click();
    await np.locator('[data-needs-kind="status-proposal"]').waitFor({ state: 'detached' });
    check('confirmed Apply sends apply-proposal', JSON.stringify(last()) === JSON.stringify({ action: 'apply-proposal', id: 'pr2' }));
    // Learned rules: proposals, the accepted list and the Moved by agent badge.
    await np.locator('[data-needs-kind="preference-proposal"]').waitFor();
    const pf = np.locator('[data-needs-id="pf1"]');
    check('rule proposal shows its text and the decisions it came from', (await pf.textContent()).includes('Drops roles that need weekly travel.') &&
      (await pf.locator('ul.needs-sources li').allTextContents()).join('|') === 'Adventure Works · Head of Engineering · Dropped|Fabrikam Systems · VP Engineering · Dropped');
    check('learned rules list shows edited wording and last learned time', await np.locator('[data-rule-id]').count() === 2 && (await np.locator('.learned-rules').textContent()).includes('Avoids agencies and consultancies.') && (await np.locator('.learned-rules').textContent()).includes('Last learned'));
    const pfBtn = await box(np, '[data-pf-act="accept"]'), prBtn = await box(np, '[data-pr-act="delete"]');
    check('rule buttons match the Needs you buttons', pfBtn.h === 44 && prBtn.h === 44 && pfBtn.radius === sizes.card.radius && prBtn.border === sizes.cardGhost.border && prBtn.bg === sizes.cardGhost.bg);
    console.log('rule button sizes at 1440', JSON.stringify({ pfBtn, prBtn, source: await box(np, 'ul.needs-sources button') }));
    await pf.locator('ul.needs-sources button').first().click();
    await np.locator('.role-header').waitFor();
    check('a source opens its job without a left-Needs-you notice', (await np.locator('.role-header').textContent()).includes('Adventure Works') && await np.locator('.workspace .notice').count() === 0);
    await pf.locator('[data-pf-act="edit"]').click();
    await pf.locator('textarea').fill('Drops roles needing weekly travel.');
    await pf.locator('[data-pf-act="save-edit"]').click();
    await pf.waitFor({ state: 'detached' });
    check('Edit sends edit-preference with the new wording and the rule joins the list', JSON.stringify(last()) === JSON.stringify({ action: 'edit-preference', id: 'pf1', text: 'Drops roles needing weekly travel.' }) && await np.locator('[data-rule-id]').count() === 3);
    await np.locator('[data-rule-id="r2"] [data-pr-act="edit"]').click();
    await np.locator('[data-rule-id="r2"] textarea').fill('Avoids agencies.');
    await np.locator('[data-rule-id="r2"] [data-pr-act="save-edit"]').click();
    await np.getByText('Rule saved').first().waitFor();
    check('editing a listed rule sends edit-preference', JSON.stringify(last()) === JSON.stringify({ action: 'edit-preference', id: 'r2', text: 'Avoids agencies.' }));
    await np.locator('[data-rule-id="r1"] [data-pr-act="delete"]').click();
    await np.getByRole('alertdialog').getByRole('button', { name: 'Delete rule' }).click();
    await np.locator('[data-rule-id="r1"]').waitFor({ state: 'detached' });
    check('Delete confirms and sends delete-preference', JSON.stringify(last()) === JSON.stringify({ action: 'delete-preference', id: 'r1' }));
    check('Moved by agent badge names the stage and date, and is hidden once undone', await (async () => {
      await np.goto(origin + '/admin.html?job=mv1');
      await np.locator('.role-header').waitFor();
      const label = await np.locator('.role-stage [aria-label^="Moved by agent"]').getAttribute('aria-label');
      const card = await np.locator('[data-select-job="mv1"] [aria-label^="Moved by agent"]').count();
      const none = await np.locator('[data-select-job="mv2"] [aria-label^="Moved by agent"]').count();
      return /^Moved by agent to Reviewing on /.test(label) && card === 1 && none === 0;
    })());
    const badge = await box(np, '.role-stage [aria-label^="Moved by agent"]'), stageBadge = await box(np, '.role-stage .pipeline-stage');
    check('the badge matches the stage badge style', badge.font === stageBadge.font && badge.radius === stageBadge.radius);
    await np.goto(origin + '/admin.html?collection=needs');
    await np.locator('[data-needs-kind]').first().waitFor();
    // Open the role from a card.
    await np.locator('[data-needs-kind="posting-gaps"] .needs-open').click();
    await np.locator('.role-header').waitFor();
    check('company and role open the workspace', (await np.locator('.role-header').textContent()).includes('Northwind Labs') && new URL(np.url()).searchParams.get('job') === 'pc1');
    // Workspace posting check.
    await np.locator('[data-section="materials"]').click();
    await np.locator('.posting-check').waitFor();
    check('Documents shows the posting check with gaps and form questions', await np.locator('.posting-check').evaluate(el => ['Salary range', 'Office days', 'Why do you want to lead engineering', 'Greenhouse'].every(t => el.textContent.includes(t))));
    check('asked and dismissed gaps keep their state in the workspace', (await np.locator('.posting-check [data-gap-item="g1"]').textContent()).includes('Could you share the salary band') && (await np.locator('.posting-check [data-gap-item="g2"]').textContent()).includes('Dismissed'));
    check('a fetched form has no paste box', await np.locator('[data-pc-paste]').count() === 0);
    await np.locator('[data-pc-act="rerun"]').click();
    await np.getByText('Posting check requested').first().waitFor();
    check('Re-run check sends rerun-posting-check', JSON.stringify(last()) === JSON.stringify({ action: 'rerun-posting-check', id: 'pc1' }));
    const qaBtn = await box(np, '.posting-check [data-pc-act="rerun"]');
    check('workspace posting check buttons are 44px', qaBtn.h === 44);
    // Paste questions (form not detected).
    await np.goto(origin + '/admin.html?job=pc2&section=materials');
    await np.locator('[data-pc-paste]').waitFor();
    check('not-detected form shows the paste box', (await np.locator('.posting-check').textContent()).includes('Paste application questions'));
    await np.locator('[data-pc-paste]').fill('Why us?\nNotice period*');
    await np.locator('[data-pc-act="paste"]').click();
    await np.locator('[data-answer-item="pq1"]').waitFor();
    check('Save questions sends paste-questions', JSON.stringify(last()) === JSON.stringify({ action: 'paste-questions', id: 'pc2', text: 'Why us?\nNotice period*' }) &&
      (await np.locator('[data-answer-item="pq1"]').textContent()).includes('Required'));
    // Timeline.
    await np.goto(origin + '/admin.html?job=ap1&section=overview');
    await np.locator('.interview-timeline').waitFor();
    check('timeline lists dated entries with source badges', (await np.locator('.timeline-entry').count()) === 3 && (await np.locator('.timeline-entry').first().textContent()).includes('Email') && (await np.locator('.timeline-entry').nth(1).textContent()).includes('Manual') && (await np.locator('.timeline-entry').nth(2).textContent()).includes('Final round'));
    await np.locator('[data-tl-entry="t2"][data-tl-notes]').fill('Prepare the platform strategy.');
    await np.locator('[data-tl-act="add"]').focus();
    await np.getByText('Saved', { exact: true }).first().waitFor();
    check('editing notes sends timeline-edit on leaving the field', JSON.stringify(last()) === JSON.stringify({ action: 'timeline-edit', id: 'ap1', entryId: 't2', entry: { notes: 'Prepare the platform strategy.' } }));
    await np.locator('[data-tl-field="date"]').fill('2026-11-03');
    await np.locator('[data-tl-field="round"]').fill('Final round');
    await np.locator('[data-tl-field="kind"]').selectOption('video');
    await np.locator('[data-tl-field="notes"]').fill('Meet the VP of Product.');
    const tlInput = await box(np, '[data-tl-field="round"]'), tlSelect = await box(np, '[data-tl-field="kind"]'), tlButton = await box(np, '[data-tl-act="add"]');
    await np.locator('[data-tl-act="add"]').click();
    await np.locator('.timeline-entry').nth(3).waitFor();
    check('Add entry sends timeline-add and lists it', JSON.stringify(last()) === JSON.stringify({ action: 'timeline-add', id: 'ap1', entry: { date: '2026-11-03', round: 'Final round', kind: 'video', notes: 'Meet the VP of Product.' } }));
    await np.locator('[data-tl-act="remove"]').nth(3).click();
    await np.getByRole('alertdialog').getByRole('button', { name: 'Remove interview' }).click();
    await np.locator('.timeline-entry').nth(3).waitFor({ state: 'detached' });
    check('Remove confirms and sends timeline-remove', last().action === 'timeline-remove' && last().id === 'ap1' && last().entryId === 'new3');
    await np.locator('[data-section="context"]').click();
    const ctxInput = await box(np, '#role');
    check('timeline inputs match Role details inputs', tlInput.h === ctxInput.h && tlSelect.h === ctxInput.h && tlInput.h === 44 && tlInput.radius === ctxInput.radius && tlInput.border === ctxInput.border && tlInput.bg === ctxInput.bg && tlButton.h === 44);
    console.log('timeline sizes at 1440', JSON.stringify({ tlInput, tlSelect, tlButton, ctxInput, qaBtn }));
    // Mobile.
    const fresh = await needsFixture(browser);
    const mp = fresh.page;
    await mp.setViewportSize({ width: 390, height: 844 });
    await mp.goto(origin + '/admin.html?collection=needs');
    await mp.locator('[data-needs-kind]').first().waitFor();
    const m = { ask: await box(mp, '[data-pc-act="ask"]'), dismiss: await box(mp, '[data-pc-act="dismiss-gap"]'), area: await box(mp, '[data-needs-kind="application-answers"] textarea'), agentCard: await box(mp, 'button.pipeline-item[data-select-job="ag1"]'), needsCard: await box(mp, '.needs-card') };
    check('mobile Needs you buttons are 44px and the cards fit', m.ask.h === 44 && m.dismiss.h === 44 && m.agentCard.w === m.needsCard.w && await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log('needs-you sizes at 390', JSON.stringify(m));
    await np.setViewportSize({ width: 390, height: 844 });
    await np.goto(origin + '/admin.html?job=ap1&section=overview');
    await np.locator('.interview-timeline').waitFor();
    const mt = { input: await box(np, '[data-tl-field="round"]'), select: await box(np, '[data-tl-field="kind"]'), add: await box(np, '[data-tl-act="add"]') };
    check('mobile timeline fields stack at 44px without sideways scroll', mt.input.h === 44 && mt.select.h === 44 && mt.add.h === 44 && mt.input.w === mt.select.w && await np.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log('timeline sizes at 390', JSON.stringify(mt));
    await mp.setViewportSize({ width: 1440, height: 900 });
    await mp.goto(origin + '/admin.html?collection=needs');
    await mp.locator('[data-needs-kind]').first().waitFor();
    await settle(mp);
    const needsAudit = await new AxeBuilder({ page: mp }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    check('Needs you has no automated WCAG A/AA violations', needsAudit.violations.length === 0 || (console.log(JSON.stringify(needsAudit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })))), false));
    check('no browser errors in the Needs you fixture', fx.pageErrors.length === 0 && fresh.pageErrors.length === 0);
    await fx.context.close(); await fresh.context.close();
  }
  check('no browser errors', errors.length === 0);
  console.log(`passed ${passed}, failed 0`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
