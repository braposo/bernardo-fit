import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { questionId } from './ats-forms.js';
import { applicationUrl } from './application-form-discovery.js';

const publicAddress = address => {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254)
    && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168)
    && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && [18, 19].includes(b));
};

export async function publicApplicationHost(value, resolve = lookup) {
  const url = applicationUrl(value);
  if (!url) return false;
  try {
    const addresses = await resolve(new URL(url).hostname, { all: true, family: 4 });
    return addresses.length > 0 && addresses.every(item => publicAddress(item.address));
  } catch { return false; }
}

// Runs in the page. Read fields only; never type, upload, click consent or submit.
export function inspectApplicationDocument() {
  const visible = el => !!(el.getClientRects().length || el.type === 'file' && el.closest('form'));
  const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const forms = [...document.querySelectorAll('form')];
  const application = forms.find(form => form.querySelector('input[type="file"]'))
    || forms.find(form => [...form.querySelectorAll('button,input[type="submit"]')]
      .some(el => /submit application|send application|apply now/i.test(text(el) || el.value || '')));
  const scope = application || document;
  const fields = [...scope.querySelectorAll('input,textarea,select,[role="combobox"]')]
    .filter(el => !['hidden', 'submit', 'button', 'reset', 'search'].includes(el.type) && !el.disabled && visible(el));
  const questions = [], groups = new Map();
  for (const el of fields) {
    const group = el.closest('fieldset');
    const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => text(document.getElementById(id))).filter(Boolean).join(' ');
    const label = labelled || el.getAttribute('aria-label') || [...(el.labels || [])].map(text).join(' ') || el.placeholder || '';
    if (!label && !group) continue;
    const choice = ['radio', 'checkbox'].includes(el.type);
    const groupLabel = choice && text(group?.querySelector('legend'));
    const title = groupLabel || label;
    const key = groupLabel ? `${el.type}:${el.name || groupLabel}` : `${el.id || el.name}:${title}`;
    const required = !!el.required || el.getAttribute('aria-required') === 'true' || /\*|\(required\)/i.test(title);
    if (groups.has(key)) {
      const q = groups.get(key); q.required ||= required;
      if (choice && label) q.options.push(label);
      continue;
    }
    const kind = el.type === 'file' ? 'file' : el.type === 'checkbox' && !groupLabel ? 'consent'
      : choice || el.tagName === 'SELECT' || el.getAttribute('role') === 'combobox' ? 'choice' : 'text';
    const q = { text: title.slice(0, 2000), required, kind,
      options: el.tagName === 'SELECT' ? [...el.options].filter(o => o.value).map(text) : choice ? [label] : [],
      maxLength: el.maxLength > 0 ? el.maxLength : null, accept: el.accept || '',
      manual: el.type === 'password' || el.getAttribute('role') === 'combobox', limit: 120 };
    questions.push(q); groups.set(key, q);
  }
  const buttons = [...scope.querySelectorAll('button,input[type="submit"]')].filter(visible)
    .map(el => text(el) || el.value || '');
  const submit = buttons.some(t => /submit (?:application|your)|send application|apply now|^submit$/i.test(t));
  const more = buttons.some(t => /next|continue|sign in|log in|create account/i.test(t));
  const links = [...document.querySelectorAll('a[href]')].filter(el => /^(apply|apply now|apply for this (?:job|role)|apply for job|submit application)$/i.test(text(el)))
    .map(el => el.href);
  return { questions, complete: questions.length > 0 && submit && !more && !questions.some(q => q.manual), links };
}

export async function readApplicationForm({ url, policy }, { launch } = {}) {
  if (!await publicApplicationHost(url)) throw Object.assign(new Error('Application URL must be a public HTTPS page.'), { abort: true });
  const chromium = launch ? null : (await import('playwright')).chromium;
  const browser = await (launch ? launch() : chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined }));
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    // No application writes. Check each navigation/subresource including redirects.
    await context.route('**/*', async route => {
      const request = route.request();
      if (!['GET', 'HEAD'].includes(request.method()) || !await publicApplicationHost(request.url())) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(policy.requestTimeoutSeconds * 1000);
    let current = url, result;
    const visited = new Set();
    for (let hop = 0; hop < 3 && !visited.has(current); hop++) {
      visited.add(current);
      await page.goto(current, { waitUntil: 'domcontentloaded', timeout: policy.requestTimeoutSeconds * 1000 });
      // A DOM condition, not a retry/backoff engine. The task owns retries.
      await page.locator('input:not([type=hidden]),textarea,select,a').first().waitFor({ state: 'attached' }).catch(() => {});
      const snapshots = [];
      for (const frame of page.frames()) snapshots.push(await frame.evaluate(inspectApplicationDocument).catch(() => ({ questions: [], links: [] })));
      result = snapshots.find(s => s.complete) || snapshots.find(s => s.questions.length) || snapshots[0];
      if (result.questions.length) break;
      const next = snapshots.flatMap(s => s.links).map(applicationUrl).find(link => link && !visited.has(link));
      if (!next) break;
      current = next;
    }
    const seen = new Set();
    const questions = (result?.questions || []).map(q => ({ ...q, id: questionId(q.text), options: q.options.slice(0, 100) }))
      .filter(q => !seen.has(q.id) && seen.add(q.id));
    const complete = !!result?.complete && questions.length <= 100;
    return { source: 'website', url: page.url(), status: complete ? 'ready' : 'partial', complete,
      reason: complete ? '' : 'The form could only be inspected partially. Open it to check login, later steps, conditional fields and uploads.',
      questions: questions.slice(0, 100) };
  } finally { await browser.close(); }
}
