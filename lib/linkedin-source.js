import { htmlToText, descriptionFromHtml } from '../scripts/fetch-jd.mjs';
import { linkedinSettings } from './sanity/analysis-settings.js';

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
const accessError = (reason, stop = false) => Object.assign(new Error(reason), { stop });

async function publicPage(url, fetchImpl) {
  let response;
  try { response = await fetchImpl(url, { redirect: 'manual' }); }
  catch (error) { if (error.stop || error.fatal) throw error; throw accessError('LinkedIn request failed or timed out'); }
  // The shared request client handles bounded retries; never follow login redirects or challenges.
  if (!response.ok) throw accessError(`LinkedIn HTTP ${response.status}`, [301,302,303,307,308,401,403,429,999].includes(response.status));
  const html = await response.text();
  if (/captcha-internal|\/checkpoint\/challenge|<title>[^<]*(?:sign in|security verification|authwall)/i.test(html))
    throw accessError('LinkedIn requires authentication or a challenge', true);
  return html;
}

export function parseLinkedInResults(html, { requireMain = false } = {}) {
  const jobs = [];
  let resultMarkup = html;
  const primaryResults = html.match(/<(main|section)\b(?=[^>]*\bclass=["'][^"']*\btwo-pane-serp-page__results-list\b)[^>]*>([\s\S]*?)<\/\1>/i);
  if (requireMain && !primaryResults) {
    const hasPostingCard = /data-entity-urn=["']urn:li:jobPosting:\d+["']/i.test(html);
    if (!hasPostingCard && /no (?:matching )?(?:jobs|results)(?: found)?|did not match any jobs|viewed all jobs/i.test(html)) return jobs;
    throw accessError('LinkedIn primary results container is missing');
  }
  if (primaryResults) {
    const list = primaryResults[2].match(/<ul\b(?=[^>]*\bclass=["'][^"']*\bjobs-search__results-list\b)[^>]*>([\s\S]*?)<\/ul>/i);
    if (!list) throw accessError('LinkedIn primary results list is missing');
    resultMarkup = list[1];
  }
  for (const card of resultMarkup.split(/<li(?:\s[^>]*)?>/i)) {
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
  if (!jobs.length && !/no (?:matching )?(?:jobs|results)(?: found)?|did not match any jobs|viewed all jobs/i.test(html))
    throw accessError('LinkedIn returned no recognizable results or empty-search marker');
  return jobs;
}

export function linkedinWindow(lastSuccess, now = new Date()) {
  const end = now.getTime();
  const prior = lastSuccess ? Date.parse(lastSuccess) : NaN;
  if (lastSuccess && (!Number.isFinite(prior) || prior > end)) throw new Error('Invalid LinkedIn checkpoint');
  return { before: now.toISOString(), after: new Date(Number.isFinite(prior) ? prior - 86400000 : end - 7 * 86400000).toISOString() };
}

export async function searchLinkedIn({ window, fetchImpl = fetch, searches = LINKEDIN_SEARCHES, onPage } = {}) {
  const config = linkedinSettings();
  const v2 = config.policyVersion === 2;
  const activeSearches = v2 ? config.searches : searches;
  const pageSize = v2 ? config.searchPageSize : config.resultsPerSearch;
  const maxPages = v2 ? config.maxSearchPages : 1;
  const maxResults = v2 ? config.maxSearchResults : pageSize;
  if (v2 && (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 400))
    throw Object.assign(new Error('Published LinkedIn settings need a valid maxSearchResults value.'),
      { code: 'SANITY_SETTINGS_INVALID' });
  const found = new Map(), scans = [];
  let blocked = false;
  const seconds = Math.ceil((Date.parse(window.before) - Date.parse(window.after)) / 1000);
  for (const search of activeSearches) {
    let start = 0, pages = 0, foundForSearch = 0, ended = false, bounded = false, partialReason, failedReason;
    const seen = new Set();
    while (pages < maxPages) {
      const url = new URL(start > 0 && v2
        ? 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search'
        : 'https://www.linkedin.com/jobs/search/');
      url.search = new URLSearchParams({ keywords: search.keywords, location: search.location,
        f_TPR: `r${seconds}`, sortBy: 'DD', ...(v2 ? { count: String(pageSize) } : {}),
        ...(search.remote && !v2 ? { f_WT: '2' } : {}),
      }).toString();
      if (v2 || start > 0) url.searchParams.set('start', String(start));
      try {
        const html = await publicPage(url, fetchImpl);
        // The guest continuation returns only a list fragment. An empty fragment
        // is the endpoint's end-of-results signal; short pages are not.
        const pageJobs = start > 0 && v2 && !html.trim() ? []
          : parseLinkedInResults(html, { requireMain: v2 && start === 0 });
        pages++;
        if (!pageJobs.length) { ended = true; break; }
        const jobs = v2 ? pageJobs : pageJobs.slice(0, pageSize);
        let newOnPage = 0;
        for (const job of jobs) {
          if (!seen.has(job.id)) {
            seen.add(job.id);
            if (!v2 || foundForSearch < maxResults) {
              newOnPage++; foundForSearch++;
              found.set(job.id, job);
            }
          }
        }
        await onPage?.({ keywords: search.keywords, location: search.location,
          page: pages, start, found: foundForSearch, received: jobs.length });
        if (!v2) { ended = true; break; }
        if (foundForSearch >= maxResults) { ended = true; bounded = true; break; }
        if (!newOnPage) { partialReason = 'Pagination returned no new posting IDs; offset may be ignored.'; break; }
        // Advance by the actual card count. The public endpoint can return a
        // different count from the requested page-size hint.
        start += jobs.length;
      } catch (error) {
        if (error.fatal) throw error;
        failedReason = error.message;
        if (error.stop) { blocked = true; break; }
        break;
      }
    }
    scans.push({ ...search, status: failedReason ? 'failed' : bounded ? 'bounded' : ended ? 'ok' : 'partial', pages, found: foundForSearch,
      ...(bounded ? { bounded: true } : {}),
      ...(failedReason ? { reason: failedReason } : partialReason ? { reason: partialReason } : !ended ? { reason: 'Configured page limit reached before end of results.' } : {}) });
    if (blocked) break;
  }
  const complete = scans.length === activeSearches.length && scans.every(s => ['ok', 'bounded'].includes(s.status));
  return { jobs: [...found.values()], scans, blocked, complete,
    coverage: v2
      ? { pageSizeHint: pageSize, maxPagesPerSearch: maxPages, maxUniqueResultsPerSearch: maxResults,
          bounded: true, completeForConfiguredScope: complete,
          note: `Each configured search covers the newest up to ${maxResults} unique posting IDs. Public offsets and requested page size are best-effort; guest pages advance by observed card count. Reaching the configured result limit completes this daily scope; request failures, repeated pages, and the safety page ceiling before that limit remain incomplete. Posting ages may reflect reposts.` }
      : `At most the first ${pageSize} public results per search; posting ages may reflect reposts.` };
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
