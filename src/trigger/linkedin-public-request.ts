import { task, wait, runs, AbortTaskRunError } from '@trigger.dev/sdk';
import { kv } from '../../lib/kv.js';
import { fetchLinkedInPage, linkedInRetryPolicy } from '../../lib/linkedin-request.js';
import { validateLinkedInSettings } from '../../lib/sanity/linkedin-settings.js';

export const linkedinPublicRequest = task({
  id: 'linkedin-public-request', maxDuration: 60,
  retry: { maxAttempts: 4, minTimeoutInMs: 300_000, maxTimeoutInMs: 1_800_000, factor: 3, randomize: true },
  queue: { concurrencyLimit: 1 },
  catchError: linkedInRetryPolicy,
  run: async (payload: { url: string; ownerRunId: string; policy: any }, { signal, ctx }) => {
    let policy;
    try { policy = validateLinkedInSettings(payload.policy); }
    catch { throw new AbortTaskRunError('Invalid published LinkedIn request policy'); }
    const assertOwner = async () => {
      if (await (await kv()).get('linkedin-discovery:lock') !== payload.ownerRunId ||
        (await runs.retrieve(payload.ownerRunId)).isCompleted)
        throw new AbortTaskRunError('LinkedIn discovery owner is no longer active');
    };
    await assertOwner();
    try { return await fetchLinkedInPage({ url: payload.url, policy }, { signal }); }
    catch (error) {
      // Keep source ownership through a provider cooldown even on the final attempt.
      // Trigger performs the durable wait; there is no local timer or cooldown ledger.
      if (ctx.attempt.number >= policy.retry.maxAttempts && error instanceof Error && 'retryAt' in error && error.retryAt instanceof Date)
        await wait.until({ date: error.retryAt });
      throw error;
    }
  },
});
