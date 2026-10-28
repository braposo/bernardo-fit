import { task, AbortTaskRunError } from '@trigger.dev/sdk';
import { fetchJSearchPage, jsearchRetryPolicy } from '../../lib/jsearch-source.js';
import { validateJSearchSettings } from '../../lib/sanity/jsearch-settings.js';

export const jsearchRequest = task({
  id: 'jsearch-request', maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 60_000, maxTimeoutInMs: 900_000, factor: 3, randomize: true },
  queue: { concurrencyLimit: 2 },
  catchError: jsearchRetryPolicy,
  run: async (payload: { params: Record<string, string>; policy: any }, { signal }) => {
    try { validateJSearchSettings(payload.policy); }
    catch { throw new AbortTaskRunError('Invalid published JSearch request policy'); }
    return fetchJSearchPage(payload, { signal });
  },
});
