import { AbortTaskRunError, idempotencyKeys, metadata, schedules, task, tasks } from '@trigger.dev/sdk';
import { hasKV, kv } from '../../lib/kv.js';
import { withGenerationContext } from '../../lib/generation-context.js';
import { discoverJSearch } from '../../lib/jsearch-discovery.js';
import { jsearchEnabled } from '../../lib/jsearch-source.js';
import { jsearchSettings } from '../../lib/sanity/analysis-settings.js';
import { londonSchedule } from '../../functions/discover-linkedin/schedule.js';
import { discoveryQueue } from './discovery-queue';
import type { jsearchRequest } from './jsearch-request';

const STATE_KEY = 'jsearch-discovery:state';

export const jsearchDiscoveryTask = task({
  id: 'jsearch-job-discovery', maxDuration: 3600,
  queue: discoveryQueue, retry: { maxAttempts: 1 },
  run: async (payload: { date: string }, { ctx }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) throw new AbortTaskRunError('A London schedule date is required');
    if (!hasKV || process.env.SANITY_CONTENT_ENABLED !== '1' || process.env.SANITY_ANALYSIS_ENABLED !== '1')
      throw new AbortTaskRunError('Persistent storage and published Sanity analysis settings are required');

    return withGenerationContext({ runId: ctx.run.id, taskAttempt: ctx.attempt.number }, async () => {
      const settings = jsearchSettings();
      if (!settings?.enabled) {
        metadata.set('phase', 'paused');
        return { status: 'paused', reason: settings ? 'disabled' : 'unpublished' };
      }
      if (!jsearchEnabled()) throw new AbortTaskRunError('Configure JSEARCH_API_KEY in Trigger.dev to use JSearch discovery.');
      const client = await kv();
      const started = Date.now();
      const progress = (event: any) => {
        metadata.set('elapsedMs', Date.now() - started);
        for (const [key, value] of Object.entries(event))
          if (value !== undefined && value !== null && ['string', 'number', 'boolean'].includes(typeof value))
            metadata.set(key, value as string | number | boolean);
      };
      const request = async (params: Record<string, string>) => {
        const result = await tasks.triggerAndWait<typeof jsearchRequest>('jsearch-request', { params, policy: settings },
          { idempotencyKey: await idempotencyKeys.create(['jsearch-request', payload.date, JSON.stringify(params)]),
            maxAttempts: settings.retry.maxAttempts, ttl: '1d' });
        if (!result.ok) {
          const reason = result.error && typeof result.error === 'object' && 'message' in result.error
            ? String(result.error.message) : 'request task did not complete';
          throw new Error(`JSearch request failed: ${reason}`);
        }
        return result.output;
      };
      const report = await discoverJSearch({ settings, request, progress,
        state: await client.get(STATE_KEY) || {},
        saveState: async (next: any) => { await client.set(STATE_KEY, next); } });
      await client.set(`jsearch-discovery:report:${ctx.run.id}`, report, { ex: 90 * 86400 });
      metadata.set('added', report.added.length).set('discovered', report.discovered).set('assessed', report.assessed)
        .set('excluded', report.excluded).set('existing', report.existing.length).set('repeats', report.repeats.length)
        .set('overCap', report.overCap).set('phase', report.status);
      if (report.status === 'incomplete') throw new Error('JSearch discovery is incomplete; inspect the saved report. Unfinished postings are retried on the next run.');
      return report;
    });
  },
});

// Queued behind the 09:00 LinkedIn scan on the shared discovery queue.
export const jsearchDiscoverySchedule = schedules.task({
  id: 'jsearch-discovery-schedule',
  cron: { pattern: '15 9 * * *', timezone: 'Europe/London', environments: ['PRODUCTION'] },
  maxDuration: 60,
  run: async (payload) => {
    const { date } = londonSchedule(payload.timestamp);
    const idempotencyKey = await idempotencyKeys.create(['jsearch-job-discovery', date], { scope: 'global' });
    const run = await tasks.trigger<typeof jsearchDiscoveryTask>('jsearch-job-discovery', { date }, { idempotencyKey, idempotencyKeyTTL: '30d' });
    return { status: 'dispatched', date, runId: run.id };
  },
});
