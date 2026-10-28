import { createHash } from 'node:crypto';
import { AbortTaskRunError, retry } from '@trigger.dev/sdk';
import { discardResponseBody } from './http-response.js';
import { retryAfterDate } from './linkedin-request.js';

// JSearch (OpenWeb Ninja) searches Google for Jobs, so one result can come from
// LinkedIn, Indeed, Glassdoor, Reed or an employer's own careers site. The direct
// OpenWeb Ninja key is preferred; a RapidAPI key for the same API also works.
const OPENWEBNINJA_SEARCH = 'https://api.openwebninja.com/jsearch/search';
const RAPIDAPI_HOST = 'jsearch.p.rapidapi.com';

export function jsearchCredentials(env = process.env) {
  if (env.JSEARCH_API_KEY?.trim()) return { url: OPENWEBNINJA_SEARCH, headers: { 'x-api-key': env.JSEARCH_API_KEY.trim() } };
  if (env.JSEARCH_RAPIDAPI_KEY?.trim()) return { url: `https://${RAPIDAPI_HOST}/search`,
    headers: { 'x-rapidapi-key': env.JSEARCH_RAPIDAPI_KEY.trim(), 'x-rapidapi-host': RAPIDAPI_HOST } };
  return null;
}
export const jsearchEnabled = (env = process.env) => !!jsearchCredentials(env);

export function jsearchParams(search, page) {
  return { query: search.query, page: String(page), num_pages: '1', country: search.country, date_posted: search.datePosted };
}

export function jsearchRetryPolicy({ payload, error, ctx }) {
  if (error?.name === 'AbortTaskRunError') return { skipRetrying: true };
  if (ctx?.attempt?.number >= payload?.policy?.retry?.maxAttempts) return { skipRetrying: true };
  return { retry: payload.policy.retry, ...(error?.retryAt ? { retryAt: error.retryAt } : {}) };
}

// One HTTP attempt per child-task attempt; Trigger owns retries and delays.
// The key is read here, inside the worker, and never travels in a payload.
export async function fetchJSearchPage({ params, policy }, { signal, env = process.env, fetchRequest = retry.fetch } = {}) {
  signal?.throwIfAborted();
  const credentials = jsearchCredentials(env);
  if (!credentials) throw new AbortTaskRunError('Configure JSEARCH_API_KEY in Trigger.dev to use JSearch discovery.');
  const url = new URL(credentials.url);
  url.search = new URLSearchParams(params).toString();
  const response = await fetchRequest(url.toString(), { headers: { accept: 'application/json', ...credentials.headers }, signal,
    timeoutInMs: policy.requestTimeoutSeconds * 1000,
    retry: { byStatus: {}, timeout: { maxAttempts: 1 }, connectionError: { maxAttempts: 1 } },
  });
  if (!response.ok) {
    const message = `JSearch HTTP ${response.status}`;
    const retryAt = retryAfterDate(response.headers.get('retry-after'));
    discardResponseBody(response);
    if ([408, 429, 500, 502, 503, 504].includes(response.status)) throw Object.assign(new Error(message), { retryAt });
    throw new AbortTaskRunError(message);
  }
  let body;
  try { body = await response.json(); }
  catch { throw new AbortTaskRunError('JSearch returned a response that is not JSON'); }
  if (body?.status && body.status !== 'OK') throw new AbortTaskRunError(`JSearch status ${String(body.status).slice(0, 40)}`);
  if (!Array.isArray(body?.data)) throw new AbortTaskRunError('JSearch response has no job list');
  return { jobs: body.data.map(compactJob).filter(Boolean) };
}

// Keep only the fields discovery reads, so run outputs stay small.
function compactJob(job) {
  if (!job || typeof job !== 'object' || !job.job_id) return null;
  const pick = ['job_id', 'employer_name', 'job_publisher', 'job_title', 'job_apply_link', 'job_apply_is_direct',
    'job_description', 'job_is_remote', 'job_posted_at_datetime_utc', 'job_location', 'job_city', 'job_state',
    'job_country', 'job_google_link', 'job_min_salary', 'job_max_salary', 'job_salary_currency', 'job_salary_period'];
  const out = Object.fromEntries(pick.filter(key => job[key] !== undefined && job[key] !== null).map(key => [key, job[key]]));
  if (Array.isArray(job.apply_options)) out.apply_options = job.apply_options
    .filter(option => option?.apply_link).slice(0, 8)
    .map(({ publisher, apply_link, is_direct }) => ({ publisher: publisher || '', apply_link, is_direct: !!is_direct }));
  return out;
}

const httpsUrl = value => {
  try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url : null; }
  catch { return null; }
};

// LinkedIn links come as /jobs/view/<id> or /jobs/view/<title>-<id>. A JSearch
// result that LinkedIn also lists takes the LinkedIn identity, so the daily
// LinkedIn scan, the pipeline and Filtered all recognise it as the same posting.
export function linkedinIdFrom(link) {
  const url = httpsUrl(link);
  if (!url || !/(^|\.)linkedin\.com$/.test(url.hostname)) return '';
  return /^\/jobs\/view\/(?:[^/]*-)?(\d{6,})\/?$/.exec(url.pathname)?.[1] || '';
}

const links = job => [job.job_apply_link, ...(job.apply_options || []).map(option => option.apply_link)];

export function jsearchPosting(job) {
  const company = String(job.employer_name || '').trim();
  const role = String(job.job_title || '').trim();
  if (!company || !role) return null;
  const linkedinId = links(job).map(linkedinIdFrom).find(Boolean) || '';
  const direct = (job.apply_options || []).find(option => option.is_direct && httpsUrl(option.apply_link));
  const sourceUrl = linkedinId ? `https://www.linkedin.com/jobs/view/${linkedinId}`
    : [direct?.apply_link, job.job_apply_link, job.job_google_link].map(httpsUrl).find(Boolean)?.toString() || '';
  const posted = Date.parse(job.job_posted_at_datetime_utc || '');
  const location = String(job.job_location || [job.job_city, job.job_state, job.job_country].filter(Boolean).join(', ')).trim();
  return {
    // A short, stable key for screening questions and the processed checkpoint.
    id: `js${createHash('sha256').update(String(job.job_id)).digest('hex').slice(0, 16)}`,
    jobId: String(job.job_id), linkedinId, company, role, location, sourceUrl,
    publisher: String(job.job_publisher || '').trim(),
    remote: job.job_is_remote === true,
    ...(Number.isFinite(posted) ? { postedDate: new Date(posted).toISOString().slice(0, 10) } : {}),
    salary: salaryText(job), jobDescription: String(job.job_description || '').trim(),
  };
}

const PERIODS = { YEAR: 'a year', MONTH: 'a month', WEEK: 'a week', DAY: 'a day', HOUR: 'an hour' };
const SYMBOLS = { GBP: '£', USD: '$', EUR: '€' };
function salaryText(job) {
  const amount = value => Number.isFinite(value) && value > 0 ? Math.round(value).toLocaleString('en-GB') : '';
  const low = amount(job.job_min_salary), high = amount(job.job_max_salary);
  if (!low && !high) return '';
  const currency = String(job.job_salary_currency || '').toUpperCase();
  const symbol = SYMBOLS[currency] || '';
  const range = [low, high].filter(Boolean).map(value => `${symbol}${value}`).join(' to ');
  return [range, !symbol && currency ? currency : '', PERIODS[String(job.job_salary_period || '').toUpperCase()] || ''].filter(Boolean).join(' ');
}

// The ingest shape every source produces for executeIngestBatch.
export function jsearchOpportunity(posting) {
  const via = posting.publisher ? `JSearch · ${posting.publisher}` : 'JSearch';
  return {
    externalId: posting.linkedinId ? `linkedin-${posting.linkedinId}` : `jsearch-${posting.id.slice(2)}`,
    company: posting.company, role: posting.role, location: posting.location,
    ...(posting.remote ? { locationMode: 'remote' } : {}),
    ...(posting.salary ? { salary: posting.salary } : {}),
    source: via, sourceType: 'job-board', sourceUrl: posting.sourceUrl, jobDescription: posting.jobDescription,
    notes: `Discovered through JSearch (Google for Jobs)${posting.publisher ? `, listed on ${posting.publisher}` : ''}. ${posting.postedDate ? `Listed date: ${posting.postedDate}.` : 'Posting date not confirmed.'} Salary and working arrangements are only as the listing states them.`,
  };
}

// Runs every configured search, newest pages first, and returns unique postings.
// `request` performs one page request (a Trigger child task in production).
export async function searchJSearch({ settings, request, onPage }) {
  const found = new Map(), scans = [];
  for (const search of settings.searches) {
    let pages = 0, received = 0, failedReason;
    for (let page = 1; page <= settings.pagesPerSearch; page++) {
      try {
        const { jobs } = await request(jsearchParams(search, page));
        pages++; received += jobs.length;
        for (const job of jobs) {
          const posting = jsearchPosting(job);
          if (posting && !found.has(posting.id)) found.set(posting.id, posting);
        }
        await onPage?.({ query: search.query, page, received: jobs.length, found: found.size });
        if (jobs.length < 10) break; // JSearch pages hold ten results; a short page is the last.
      } catch (error) {
        if (error.fatal) throw error;
        failedReason = error.message;
        break;
      }
    }
    scans.push({ query: search.query, country: search.country, datePosted: search.datePosted, pages, received,
      status: failedReason ? 'failed' : 'ok', ...(failedReason ? { reason: failedReason } : {}) });
  }
  return { postings: [...found.values()], scans, complete: scans.every(scan => scan.status === 'ok') };
}
