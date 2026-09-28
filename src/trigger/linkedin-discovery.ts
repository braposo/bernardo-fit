import { AbortTaskRunError, metadata, task } from '@trigger.dev/sdk';
import { hasKV, kv } from '../../lib/kv.js';
import { withGenerationContext } from '../../lib/generation-context.js';
import { discoverLinkedIn } from '../../lib/linkedin-discovery.js';
import { ingestMinimumScore } from '../../lib/ingest-screening.js';

export const linkedinDiscoveryTask = task({
  id: 'linkedin-job-discovery', maxDuration: 7200,
  queue: { concurrencyLimit: 1 }, retry: { maxAttempts: 1 },
  run: async (payload: { date: string }, { ctx }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) throw new AbortTaskRunError('A London schedule date is required');
    if (!hasKV || process.env.SANITY_CONTENT_ENABLED !== '1' || process.env.SANITY_ANALYSIS_ENABLED !== '1')
      throw new AbortTaskRunError('Persistent storage and published Sanity analysis settings are required');
    if (ingestMinimumScore() !== 50) throw new AbortTaskRunError('Expected the existing inclusive 50-point admission policy');
    const client = await kv();
    const lock = 'linkedin-discovery:lock';
    if (!await client.set(lock, ctx.run.id, { nx: true, ex: 10800 }))
      throw new AbortTaskRunError('Another LinkedIn discovery run holds the source lock');
    try {
      const lastSuccess = await client.get<string>('linkedin-discovery:last-success');
      metadata.set('phase', 'discovering').set('date', payload.date);
      const report = await withGenerationContext({ runId: ctx.run.id, taskAttempt: ctx.attempt.number },
        () => discoverLinkedIn({ lastSuccess }));
      await client.set(`linkedin-discovery:report:${ctx.run.id}`, report, { ex: 90 * 86400 });
      metadata.set('added', report.added.length).set('discovered', report.discovered).set('complete', report.complete);
      if (!report.complete) throw new Error('LinkedIn scan is incomplete; inspect the saved report. The success checkpoint was not advanced.');
      await client.set('linkedin-discovery:last-success', report.window.before);
      metadata.set('phase', 'completed');
      return report;
    } finally {
      await client.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', [lock], [ctx.run.id]);
    }
  },
});
