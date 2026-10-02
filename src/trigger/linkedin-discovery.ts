import { AbortTaskRunError, metadata, task, tasks, runs, idempotencyKeys } from '@trigger.dev/sdk';
import { hasKV, kv } from '../../lib/kv.js';
import { withGenerationContext } from '../../lib/generation-context.js';
import { discoverLinkedIn } from '../../lib/linkedin-discovery.js';
import { searchLinkedIn, linkedinOpportunity } from '../../lib/linkedin-source.js';
import { linkedinSettings } from '../../lib/sanity/analysis-settings.js';
import { claimLinkedInSource } from '../../lib/linkedin-run-lock.js';
import { screenLinkedInCards } from '../../lib/linkedin-card-screening.js';
import type { linkedinPublicRequest } from './linkedin-public-request';

export const linkedinDiscoveryTask = task({
  id: 'linkedin-job-discovery', maxDuration: 7200,
  queue: { concurrencyLimit: 1 }, retry: { maxAttempts: 1 },
  run: async (payload: { date: string }, { ctx }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) throw new AbortTaskRunError('A London schedule date is required');
    if (!hasKV || process.env.SANITY_CONTENT_ENABLED !== '1' || process.env.SANITY_ANALYSIS_ENABLED !== '1')
      throw new AbortTaskRunError('Persistent storage and published Sanity analysis settings are required');

    return withGenerationContext({ runId: ctx.run.id, taskAttempt: ctx.attempt.number }, async () => {
      const policy = linkedinSettings();
      if (policy.policyVersion !== 2)
        throw new AbortTaskRunError('LinkedIn discovery needs the published Engineering Manager policy v2 before it can run.');
      if (!policy.enabled) {
        metadata.set('phase', 'paused').set('policyVersion', policy.policyVersion);
        return { status: 'paused', policyVersion: policy.policyVersion };
      }
      if (!Number.isInteger(policy.maxSearchResults) || policy.maxSearchResults < 1 || policy.maxSearchResults > 400)
        throw new AbortTaskRunError('Published LinkedIn settings need a valid maxSearchResults bound before discovery can run.');

      const client = await kv();
      const lock = 'linkedin-discovery:lock';
      if (!await claimLinkedInSource(client, ctx.run.id, runs.retrieve))
        throw new AbortTaskRunError('Another LinkedIn discovery run holds the source lock');
      const assertOwner = async () => {
        try {
          if (await client.get(lock) !== ctx.run.id) throw new AbortTaskRunError('LinkedIn discovery source lock was lost');
        } catch (error) { throw Object.assign(error, { fatal: true }); }
      };
      const started = Date.now();
      const progress = (event: any) => {
        metadata.set('phase', event.phase).set('elapsedMs', Date.now() - started);
        for (const [key, value] of Object.entries(event)) {
          if (key !== 'phase' && value !== undefined && value !== null && ['string', 'number', 'boolean'].includes(typeof value))
            metadata.set(key, value as string | number | boolean);
        }
      };
      try {
        const lastSuccess = await client.get<string>('linkedin-discovery:last-success');
        metadata.set('phase', 'discovering').set('date', payload.date).set('policyVersion', policy.policyVersion);
        const fetchImpl = async (url: string | URL) => {
          await assertOwner();
          metadata.set('phase', 'requesting');
          const result = await tasks.triggerAndWait<typeof linkedinPublicRequest>('linkedin-public-request',
            { url: String(url), ownerRunId: ctx.run.id, policy },
            { idempotencyKey: await idempotencyKeys.create(['linkedin-public-request', String(url)]),
              maxAttempts: policy.retry.maxAttempts, maxDuration: 60, ttl: '14d' });
          await assertOwner();
          if (!result.ok) {
            const reason = result.error && typeof result.error === 'object' && 'message' in result.error
              ? String(result.error.message) : 'request task did not complete';
            throw Object.assign(new Error(`LinkedIn request failed: ${reason}`), { stop: true });
          }
          return new Response(result.output.body, { status: result.output.status });
        };
        const state = await client.get('linkedin-discovery:state') || {};
        const report = await discoverLinkedIn({ lastSuccess, state, progress,
          search: (options: any) => searchLinkedIn({ ...options, fetchImpl,
            onPage: (page: any) => progress({ phase: 'searching', page: page.page,
              searchFound: page.found, searchLocation: page.location }) }),
          describe: (posting: any) => linkedinOpportunity(posting, { fetchImpl }),
          prescreenBatch: (postings: any[]) => screenLinkedInCards(postings, {
            onChunkComplete: (chunk: any) => progress({ phase: 'screening', screened: chunk.completed, screenTotal: chunk.total }),
          }),
          saveState: async (next: any) => { await assertOwner(); await client.set('linkedin-discovery:state', next); },
        });
        await assertOwner();
        await client.set(`linkedin-discovery:report:${ctx.run.id}`, report, { ex: 90 * 86400 });
        metadata.set('added', report.added.length).set('discovered', report.discovered).set('complete', report.complete)
          .set('prescreened', report.prescreening.length)
          .set('prescreenSkipped', report.prescreening.filter((row: any) => row.decision === 'skip').length)
          .set('prescreenDeferred', report.prescreening.filter((row: any) => row.decision === 'defer').length)
          .set('excluded', report.excluded).set('deferred', report.deferred)
          .set('pendingBacklog', report.pendingBacklog).set('maxSearchResults', policy.maxSearchResults)
          .set('searchCoverageComplete', report.searchCoverageComplete).set('phase', report.status)
          .set('elapsedMs', Date.now() - started);
        if (report.status === 'incomplete') throw new Error('LinkedIn scan is incomplete; inspect the saved report. Progress is saved for the next daily run.');
        if (report.complete) await client.set('linkedin-discovery:last-success', report.window.before);
        return report;
      } finally {
        await client.eval('if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end', [lock], [ctx.run.id]);
      }
    });
  },
});
