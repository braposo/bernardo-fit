// Seed/offline values only. Hosted discovery reads the published `jsearchDiscovery`
// object; while it is unpublished or disabled, JSearch discovery makes no requests.
export const DEFAULT_JSEARCH_SETTINGS = {
  enabled: false,
  searches: [
    { _key: 'engineering-manager-uk', query: 'Engineering Manager in United Kingdom', country: 'gb', datePosted: '3days' },
    { _key: 'head-of-engineering-uk', query: 'Head of Engineering in United Kingdom', country: 'gb', datePosted: '3days' },
  ],
  pagesPerSearch: 2,
  maxAssessmentsPerRun: 20,
  requestTimeoutSeconds: 30,
  retry: { maxAttempts: 3, minTimeoutInMs: 60_000, maxTimeoutInMs: 900_000, factor: 3, randomize: true },
};

export const JSEARCH_DATE_POSTED = ['today', '3days', 'week', 'month'];

const invalid = () => Object.assign(new Error('Publish valid JSearch discovery settings in Sanity.'),
  { status: 503, code: 'SANITY_SETTINGS_INVALID' });
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const text = (value, max) => typeof value === 'string' && !!value.trim() && value.length <= max;

export function validateJSearchSettings(value) {
  if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean'
    || !Array.isArray(value.searches) || value.searches.length < 1 || value.searches.length > 10
    || !value.searches.every(search => search && text(search.query, 200)
      && /^[a-z]{2}$/.test(search.country || '') && JSEARCH_DATE_POSTED.includes(search.datePosted))
    || !integer(value.pagesPerSearch, 1, 5)
    || !integer(value.maxAssessmentsPerRun, 1, 60)
    || !integer(value.requestTimeoutSeconds, 5, 60)
    || !value.retry || !integer(value.retry.maxAttempts, 1, 5)
    || !integer(value.retry.minTimeoutInMs, 1_000, 3_600_000)
    || !integer(value.retry.maxTimeoutInMs, value.retry.minTimeoutInMs, 3_600_000)
    || !Number.isFinite(value.retry.factor) || value.retry.factor < 1 || value.retry.factor > 5
    || typeof value.retry.randomize !== 'boolean') throw invalid();
  return structuredClone({ enabled: value.enabled,
    searches: value.searches.map(({ _key, query, country, datePosted }) => ({ ...(_key ? { _key } : {}), query, country, datePosted })),
    pagesPerSearch: value.pagesPerSearch, maxAssessmentsPerRun: value.maxAssessmentsPerRun,
    requestTimeoutSeconds: value.requestTimeoutSeconds, retry: value.retry });
}
