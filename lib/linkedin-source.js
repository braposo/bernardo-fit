import { htmlToText, descriptionFromHtml } from '../scripts/fetch-jd.mjs';

// The same eight public searches used by the previous daily agent workflow.
export const LINKEDIN_SEARCHES = [
  { keywords: 'Engineering Manager', location: 'United Kingdom', remote: true },
  { keywords: 'Head of Engineering', location: 'United Kingdom' },
  { keywords: 'Frontend Engineering Manager', location: 'United Kingdom' },
  { keywords: 'Design Systems', location: 'United Kingdom', remote: true },
  { keywords: 'Developer Experience', location: 'United Kingdom', remote: true },
  { keywords: 'CTO', location: 'United Kingdom', remote: true },
  { keywords: 'AI Engineering Manager', location: 'United Kingdom', remote: true },
  { keywords: 'Engineering Manager', location: 'Leeds' },
];
export const LINKEDIN_RESULT_LIMIT = 60;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const accessError = (reason, stop = false) => Object.assign(new Error(reason), { stop });

async function publicPage(url, fetchImpl) {
  let response;
  try { response = await fetchImpl(url, { signal: AbortSignal.timeout(25000), redirect: 'manual' }); }
  catch { throw accessError('LinkedIn request failed or timed out'); }
  // Do not follow redirects into login, retry throttled endpoints, rotate proxies or use cookies.
  if (!response.ok) throw accessError(`LinkedIn HTTP ${response.status}`, [301,302,303,307,308,401,403,429,999].includes(response.status));
  const html = await response.text();
  if (/captcha-internal|\/checkpoint\/challenge|<title>[^<]*(?:sign in|security verification|authwall)/i.test(html))
    throw accessError('LinkedIn requires authentication or a challenge', true);
  return html;
}

export function parseLinkedInResults(html) {
  const jobs = [];
  for (const card of html.split(/<li(?:\s[^>]*)?>/i)) {
    const id = card.match(/data-entity-urn=["']urn:li:jobPosting:(\d+)["']/)?.[1];
    if (!id) continue;
    const field = re => htmlToText(card.match(re)?.[1] || '');
    const role = field(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const company = field(/<h4[^>]*>([\s\S]*?)<\/h4>/i);
    if (!role || !company) throw accessError('LinkedIn result markup is incomplete');
    const visibleDate = card.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1];
    jobs.push({ id, company, role,
      location: field(/<span[^>]*class=["'][^"']*job-search-card__location[^"']*["'][^>]*>([\s\S]*?)<\/span>/i),
      ...(visibleDate && /^\d{4}-\d{2}-\d{2}$/.test(visibleDate) ? { postedDate: visibleDate } : {}),
      sourceUrl: `https://www.linkedin.com/jobs/view/${id}`,
    });
  }
  if (!jobs.length && !/no (?:matching )?(?:jobs|results)(?: found)?|did not match any jobs/i.test(html))
    throw accessError('LinkedIn returned no recognizable results or empty-search marker');
  return jobs;
}

export function linkedinWindow(lastSuccess, now = new Date()) {
  const end = now.getTime();
  const prior = lastSuccess ? Date.parse(lastSuccess) : NaN;
  if (lastSuccess && (!Number.isFinite(prior) || prior > end)) throw new Error('Invalid LinkedIn checkpoint');
  return { before: now.toISOString(), after: new Date(Number.isFinite(prior) ? prior - 86400000 : end - 7 * 86400000).toISOString() };
}

export async function searchLinkedIn({ window, fetchImpl = fetch, sleep = pause, searches = LINKEDIN_SEARCHES } = {}) {
  const found = new Map(), scans = [];
  let blocked = false;
  const seconds = Math.ceil((Date.parse(window.before) - Date.parse(window.after)) / 1000);
  for (const search of searches) {
    const url = new URL('https://www.linkedin.com/jobs/search/');
    url.search = new URLSearchParams({ keywords: search.keywords, location: search.location,
      f_TPR: `r${seconds}`, sortBy: 'DD', ...(search.remote ? { f_WT: '2' } : {}),
    }).toString();
    try {
      const jobs = parseLinkedInResults(await publicPage(url, fetchImpl));
      for (const job of jobs.slice(0, LINKEDIN_RESULT_LIMIT)) found.set(job.id, job);
      scans.push({ ...search, status: 'ok', found: Math.min(jobs.length, LINKEDIN_RESULT_LIMIT), bounded: jobs.length >= LINKEDIN_RESULT_LIMIT });
    } catch (error) {
      scans.push({ ...search, status: 'failed', reason: error.message });
      if (error.stop) { blocked = true; break; }
    }
    await sleep(1200);
  }
  return { jobs: [...found.values()], scans, blocked, complete: scans.length === searches.length && scans.every(s => s.status === 'ok'),
    coverage: 'At most the first 60 public results per search; posting ages may reflect reposts.' };
}

export async function linkedinOpportunity(job, { fetchImpl = fetch } = {}) {
  const html = await publicPage(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${job.id}`, fetchImpl);
  const jobDescription = descriptionFromHtml(html);
  if (!jobDescription) throw accessError('Full public job description is unavailable');
  return { externalId: `linkedin-${job.id}`, company: job.company, role: job.role, location: job.location,
    source: 'LinkedIn direct search', sourceType: 'job-board', sourceUrl: job.sourceUrl, jobDescription,
    notes: `Discovered through public LinkedIn search. ${job.postedDate ? `Visible posting date: ${job.postedDate}.` : 'Posting date not confirmed.'} Working arrangements and salary are only as stated in the original description; location alone does not imply remote work.`,
  };
}
