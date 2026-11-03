import { task, AbortTaskRunError } from '@trigger.dev/sdk';
import { readApplicationForm } from '../../lib/application-form-reader.js';
import { validatePostingCheck } from '../../lib/sanity/posting-check-settings.js';

export const applicationFormRequest = task({
  id: 'application-form-request', maxDuration: 180,
  retry: { maxAttempts: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 10000, factor: 2 },
  queue: { concurrencyLimit: 2 },
  run: async (payload: { url: string; policy: any }) => {
    try { return await readApplicationForm({ url: payload.url, policy: validatePostingCheck(payload.policy) }); }
    catch (error) {
      if (error && typeof error === 'object' && 'abort' in error) throw new AbortTaskRunError(String((error as Error).message));
      throw error;
    }
  },
});
