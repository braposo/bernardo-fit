import { AbortTaskRunError, idempotencyKeys, runs, task, tasks } from '@trigger.dev/sdk';
import { kv } from '../../lib/kv.js';
import { linkedinOpportunity } from '../../lib/linkedin-source.js';
import { claimLinkedInSource } from '../../lib/linkedin-run-lock.js';
import { FILTERED_DESCRIPTION_TASK_ID } from '../../lib/task-policy.js';
import type { linkedinPublicRequest } from './linkedin-public-request';

// Fetches one public LinkedIn posting for a role moved out of Filtered. It
// shares the discovery source lock, so it never overlaps a daily scan: while a
// scan holds the lock this attempt fails and Trigger retries after a backoff.
// Each request is a single attempt so the lock is held for seconds, never
// through a provider cooldown that could block the next scheduled scan.
export const filteredJobDescriptionTask = task({
  id: FILTERED_DESCRIPTION_TASK_ID, maxDuration: 120,
  retry: { maxAttempts: 6, factor: 2, minTimeoutInMs: 120_000, maxTimeoutInMs: 1_200_000, randomize: true },
  queue: { concurrencyLimit: 1 },
  run: async (payload: { posting: any; policy: any }, { ctx }) => {
    const client = await kv();
    if (!await claimLinkedInSource(client, ctx.run.id, runs.retrieve))
      throw new Error('LinkedIn discovery is using the source; trying again after it finishes.');
    try {
      const fetchImpl = async (url: string | URL) => {
        const result = await tasks.triggerAndWait<typeof linkedinPublicRequest>('linkedin-public-request',
          { url: String(url), ownerRunId: ctx.run.id, policy: payload.policy },
          { idempotencyKey: await idempotencyKeys.create(['linkedin-public-request', String(url)], { scope: 'attempt' }),
            maxAttempts: 1, maxDuration: 60 });
        if (!result.ok) {
          const reason = result.error && typeof result.error === 'object' && 'message' in result.error
            ? String(result.error.message) : 'request task did not complete';
          throw new Error(`LinkedIn request failed: ${reason}`);
        }
        return new Response(result.output.body, { status: result.output.status });
      };
      try { return await linkedinOpportunity(payload.posting, { fetchImpl }); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A removed or expired posting will not come back on retry.
        if (/description is unavailable|LinkedIn HTTP (404|410)/.test(message))
          throw new AbortTaskRunError('LinkedIn no longer shows a description for this posting. Add it in Role details, then assess fit.');
        throw error;
      }
    } finally {
      await client.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
        ['linkedin-discovery:lock'], [ctx.run.id]);
    }
  },
});
