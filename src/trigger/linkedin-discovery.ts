import { AbortTaskRunError, metadata, task, wait, logger } from '@trigger.dev/sdk';
import { hasKV, kv } from '../../lib/kv.js';
import { withGenerationContext } from '../../lib/generation-context.js';
import { discoverLinkedIn } from '../../lib/linkedin-discovery.js';
import { searchLinkedIn, linkedinOpportunity } from '../../lib/linkedin-source.js';
import { linkedinRequest } from '../../lib/linkedin-request.js';

export const linkedinDiscoveryTask = task({
  id: 'linkedin-job-discovery', maxDuration: 7200,
  queue: { concurrencyLimit: 1 }, retry: { maxAttempts: 1 },
  run: async (payload: { date: string }, { ctx }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) throw new AbortTaskRunError('A London schedule date is required');
    if (!hasKV || process.env.SANITY_CONTENT_ENABLED !== '1' || process.env.SANITY_ANALYSIS_ENABLED !== '1')
      throw new AbortTaskRunError('Persistent storage and published Sanity analysis settings are required');
    const client = await kv();
    const lock = 'linkedin-discovery:lock';
    if (!await client.set(lock, ctx.run.id, { nx: true, ex: 10800 }))
      throw new AbortTaskRunError('Another LinkedIn discovery run holds the source lock');
    const renewLock = async () => {
      try {
        const owned = await client.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], 10800) else return 0 end', [lock], [ctx.run.id]);
        if (!owned) throw new AbortTaskRunError('LinkedIn discovery source lock was lost');
      } catch (error) { throw Object.assign(error, { fatal: true }); }
    };
    try {
      return await withGenerationContext({ runId: ctx.run.id, taskAttempt: ctx.attempt.number }, async () => {
        const lastSuccess = await client.get<string>('linkedin-discovery:last-success');
        metadata.set('phase', 'discovering').set('date', payload.date);
        const fetchImpl = linkedinRequest({
          notBefore: await client.get<number>('linkedin-discovery:cooldown-until') || 0,
          onCooldown: async (until: number) => {
            await renewLock();
            await client.set('linkedin-discovery:cooldown-until', until);
          },
          sleep: async (ms: number) => {
            await renewLock();
            await wait.for({ seconds: Math.ceil(ms / 1000) });
            await renewLock();
          },
          onWait: async (info: { reason: string; seconds: number }) => {
            metadata.set('phase', info.reason === 'throttling' ? 'throttling' : 'cooling-down').set('waitSeconds', info.seconds);
            logger.info('LinkedIn request paused', info);
          },
        });
        const state = await client.get('linkedin-discovery:state') || {};
        const report = await discoverLinkedIn({ lastSuccess, state,
          search: (options: any) => searchLinkedIn({ ...options, fetchImpl, sleep: async () => {} }),
          describe: (posting: any) => linkedinOpportunity(posting, { fetchImpl }),
          sleep: async () => {},
          saveState: async (next: any) => { await renewLock(); await client.set('linkedin-discovery:state', next); },
        });
        await renewLock();
        await client.set(`linkedin-discovery:report:${ctx.run.id}`, report, { ex: 90 * 86400 });
        metadata.set('added', report.added.length).set('discovered', report.discovered).set('complete', report.complete)
          .set('prescreened', report.prescreening.length).set('prescreenSkipped', report.prescreening.filter(row => row.decision === 'skip').length)
          .set('deferred', report.deferred).set('phase', report.status).set('waitSeconds', 0);
        if (report.status === 'incomplete') throw new Error('LinkedIn scan is incomplete; inspect the saved report. Progress is saved for the next daily run.');
        if (report.complete) await client.set('linkedin-discovery:last-success', report.window.before);
        return report;
      });
    } finally {
      await client.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', [lock], [ctx.run.id]);
    }
  },
});
