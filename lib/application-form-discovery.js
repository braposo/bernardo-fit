import { complete } from './openai.js';
import { parseLooseJson } from './json.js';
import { findAtsTarget } from './ats-forms.js';



export function applicationUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
      || /(^|\.)(linkedin\.com|indeed\.com|glassdoor\.[a-z.]+)$/.test(url.hostname)
      || !url.hostname.includes('.') || /^[\d.:\[\]]+$/.test(url.hostname)) return '';
    return url.href;
  } catch { return ''; }
}

export async function discoverApplication(job, settings, { search = complete } = {}) {
  const target = findAtsTarget(job);
  if (target) return { url: target.url, reason: '', target };
  if (!settings.discoveryPrompt?.trim() || !settings.discoveryModel?.trim() || !Number.isInteger(settings.maxDiscoverySearches))
    throw new Error('Publish the application discovery prompt and model in Sanity.');
  const result = await search({ model: settings.discoveryModel, effort: 'low', maxTokens: 2000,
    kind: 'application-discovery', ref: `application-discovery:${job.id}`,
    tools: [{ name: 'web_search' }], maxSearches: settings.maxDiscoverySearches,
    system: { stable: settings.discoveryPrompt },
    messages: [{ role: 'user', content: JSON.stringify({ company: job.company, role: job.role,
      location: job.location, sourceUrl: job.sourceUrl, posting: String(job.jobDescription || '').slice(0, 12000) }) }] });
  const raw = parseLooseJson(result.text, v => v && typeof v === 'object');
  const url = applicationUrl(raw?.url);
  const sources = (result.blocks || []).flatMap(b => b.type === 'web_search_tool_result' && Array.isArray(b.content)
    ? b.content : b.citations || []);
  // Only accept a link that actually occurred in search evidence.
  if (!url || !sources.some(s => applicationUrl(s.url) === url))
    return { url: '', reason: String(raw?.reason || 'The employer application link could not be verified.').slice(0, 500) };
  return { url, reason: '' };
}
