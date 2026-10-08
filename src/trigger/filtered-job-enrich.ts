import { AbortTaskRunError, idempotencyKeys, metadata, task } from '@trigger.dev/sdk';
import { withGenerationContext } from '../../lib/generation-context.js';
import { completeMovedJob } from '../../lib/filtered-job-enrich.js';
import { hasKV } from '../../lib/kv.js';
import { linkedinSettings, withAnalysisSettings } from '../../lib/sanity/analysis-settings.js';
import { FILTERED_ENRICH_TASK_ID } from '../../lib/task-policy.js';
import { filteredJobDescriptionTask } from './filtered-job-description.js';

// Brings a role moved out of Filtered up to the same level as admitted roles.
// The description child owns LinkedIn retries; this task retries only the
// assessment, whose paid steps are checkpointed by the Jev work itself.
export const filteredJobEnrichTask = task({
  id: FILTERED_ENRICH_TASK_ID, maxDuration: 300,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 15000, randomize: true },
  queue: { concurrencyLimit: 2 },
  run: async (payload: { jobId: string; requestId: string }, { ctx }) => withAnalysisSettings(() =>
    withGenerationContext({ jobId: payload.jobId, runId: ctx.run.id, taskAttempt: ctx.attempt.number }, async () => {
      if (!hasKV) throw new AbortTaskRunError('KV is required by persistent workers.');
      metadata.set('phase', 'loading');
      try {
        const result = await completeMovedJob(payload, {
          progress: (phase: string) => { metadata.set('phase', phase); },
          fetchDescription: async (posting: any) => {
            const policy = linkedinSettings();
            if (!policy.enabled) throw Object.assign(new Error('LinkedIn fetching is paused in Analysis settings. Add the description in Role details, then assess fit.'), { abort: true });
            const result = await filteredJobDescriptionTask.triggerAndWait({ posting, policy },
              { idempotencyKey: await idempotencyKeys.create(['filtered-job-description', String(posting.id)]),
                tags: [`job:${payload.jobId}`] });
            if (!result.ok) {
              const reason = result.error && typeof result.error === 'object' && 'message' in result.error
                ? String(result.error.message) : 'the LinkedIn request did not complete';
              throw Object.assign(new Error(`Could not fetch the job description: ${reason}`), { abort: true });
            }
            return result.output;
          },
        });
        metadata.set('phase', result.outcome);
        return result;
      } catch (error) {
        if (error && typeof error === 'object' && 'abort' in error)
          throw new AbortTaskRunError(error instanceof Error ? error.message : 'This role cannot be completed.');
        throw error;
      }
    })),
});
