import { AbortTaskRunError, idempotencyKeys, logger, metadata, schedules, tasks } from '@trigger.dev/sdk';
import { hasKV, kv } from '../../lib/kv.js';
import { withGenerationContext } from '../../lib/generation-context.js';
import { gmailEnabled } from '../../lib/gmail-source.js';
import { runGmailStatusCheck } from '../../lib/gmail-status-check.js';
import { listJobs } from '../../lib/store.js';
import { emailStatusSettings } from '../../lib/sanity/analysis-settings.js';
import { GMAIL_REQUEST_TASK_ID, GMAIL_STATUS_CHECK_TASK_ID } from '../../lib/task-policy.js';
import type { gmailRequest } from './gmail-request';

// Messages already checked are remembered for a week (longer than the 3-day
// search window) so a rerun reads and classifies only new mail. A cache only:
// the proposals themselves live in Sanity and are deduplicated there.
const SEEN_TTL_SECONDS = 7 * 86400;
const seenKey = (id: string) => `gmail-status-check:seen:${id}`;

// Daily, 07:10 London, Production only (as the other schedules). Reads recent
// recruiting email and saves status proposals for Bernardo to apply or dismiss
// (docs/gmail-status-check.md). Paused, with no Gmail or model request, unless
// emailStatusProposals.enabled and emailStatusProposals.gmailCheck.enabled are
// both published true. Jev decides which job an email is about and what it
// means; a small writing model writes the summary for relevant emails only
// (without TYPESAFE_API_KEY, one small model call classifies instead). Gmail
// requests and model calls run in child tasks that own their retries and are
// reused if this run retries.
export const gmailStatusCheck = schedules.task({
  id: GMAIL_STATUS_CHECK_TASK_ID,
  cron: { pattern: '10 7 * * *', timezone: 'Europe/London', environments: ['PRODUCTION'] },
  maxDuration: 900,
  retry: { maxAttempts: 2, factor: 2, minTimeoutInMs: 5000, maxTimeoutInMs: 30000, randomize: true },
  run: async (payload, { ctx }) => {
    if (!hasKV || process.env.SANITY_CONTENT_ENABLED !== '1' || process.env.SANITY_ANALYSIS_ENABLED !== '1')
      throw new AbortTaskRunError('Persistent storage and published Sanity analysis settings are required');
    return withGenerationContext({ runId: ctx.run.id, taskAttempt: ctx.attempt.number }, async () => {
      const settings = emailStatusSettings();
      if (settings?.enabled && settings.gmailCheck?.enabled && !gmailEnabled())
        throw new AbortTaskRunError('Configure GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN in Trigger.dev Production.');
      const client = await kv();
      const request = async (body: { op: 'list'; query: string; maxResults: number } | { op: 'get'; id: string }) => {
        const result = await tasks.triggerAndWait<typeof gmailRequest>(GMAIL_REQUEST_TASK_ID, body,
          { idempotencyKey: await idempotencyKeys.create(['gmail-request', JSON.stringify(body)]), ttl: '1d' });
        if (!result.ok) {
          const reason = result.error && typeof result.error === 'object' && 'message' in result.error
            ? String(result.error.message) : 'request task did not complete';
          throw new Error(`Gmail request failed: ${reason}`);
        }
        return result.output as any;
      };
      metadata.set('phase', 'checking');
      const summary = await runGmailStatusCheck({
        settings,
        gmail: { list: ({ query, maxResults }: { query: string; maxResults: number }) => request({ op: 'list', query, maxResults }), get: (id: string) => request({ op: 'get', id }) },
        loadJobs: () => listJobs({ includeArchived: true }),
        seen: {
          has: async (ids: string[]) => {
            if (!ids.length) return new Set<string>();
            const values = await client.mget(...ids.map(seenKey));
            return new Set(ids.filter((_, index) => values[index] != null));
          },
          add: async (id: string, outcome: string) => { await client.set(seenKey(id), outcome, { ex: SEEN_TTL_SECONDS }); },
        },
        // A Date from the schedule; a manual test run may pass an ISO string.
        now: payload.timestamp,
        warn: (message: string, detail: string) => logger.warn(message, { detail }),
      });
      for (const [key, value] of Object.entries(summary))
        if (['string', 'number'].includes(typeof value)) metadata.set(key, value as string | number);
      metadata.set('phase', summary.status);
      logger.info('Gmail status check', summary);
      return summary;
    });
  },
});
