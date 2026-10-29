import { AbortTaskRunError, metadata, schedules } from '@trigger.dev/sdk';
import { hasKV } from '../../lib/kv.js';
import { withGenerationContext } from '../../lib/generation-context.js';
import { learnPreferences } from '../../lib/review-preferences.js';
import { listReviewDecisions } from '../../lib/review-decisions.js';
import { listJobs } from '../../lib/store.js';
import { reviewAgentSettings } from '../../lib/sanity/analysis-settings.js';
import { LEARN_PREFERENCES_TASK_ID } from '../../lib/task-policy.js';

// Weekly, Monday 07:00 London, Production only (as the other schedules).
// Proposes plain-language preference rules from Bernardo's recent review
// decisions; they wait in Needs you until he accepts, edits or rejects them.
// Paused (no model call) while reviewAgent.learnPreferences is off or
// unpublished. The model call is durable: its provider child owns retries and
// the answer is reused if the final write is retried, so this task retries
// only its own reads and that write.
export const learnPreferencesSchedule = schedules.task({
  id: LEARN_PREFERENCES_TASK_ID,
  cron: { pattern: '0 7 * * 1', timezone: 'Europe/London', environments: ['PRODUCTION'] },
  maxDuration: 300,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2000, maxTimeoutInMs: 15000, randomize: true },
  run: async (payload, { ctx }) => {
    if (!hasKV || process.env.SANITY_CONTENT_ENABLED !== '1' || process.env.SANITY_ANALYSIS_ENABLED !== '1')
      throw new AbortTaskRunError('Persistent storage and published Sanity analysis settings are required');
    return withGenerationContext({ runId: ctx.run.id, taskAttempt: ctx.attempt.number }, async () => {
      metadata.set('phase', 'learning');
      const result = await learnPreferences({ settings: reviewAgentSettings(),
        loadDecisions: listReviewDecisions, loadJobs: () => listJobs({ includeArchived: true }), now: payload.timestamp });
      metadata.set('phase', result.outcome);
      return result;
    });
  },
});
