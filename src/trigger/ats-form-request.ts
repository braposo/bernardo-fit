import { task, AbortTaskRunError } from '@trigger.dev/sdk';
import { atsRetryPolicy, fetchAtsPosting } from '../../lib/ats-forms.js';
import { validatePostingCheck } from '../../lib/sanity/posting-check-settings.js';
import { ATS_FORM_REQUEST_TASK_ID } from '../../lib/task-policy.js';

// One public job-board API read (Greenhouse, Lever or Ashby) for check-posting.
// The URL is built in code from the parsed target; no credentials are used.
// Exactly one HTTP attempt per task attempt: Trigger owns retries and delays,
// honouring a Retry-After through catchError.
export const atsFormRequest = task({
  id: ATS_FORM_REQUEST_TASK_ID, maxDuration: 120,
  retry: { maxAttempts: 3, minTimeoutInMs: 5_000, maxTimeoutInMs: 120_000, factor: 3, randomize: true },
  queue: { concurrencyLimit: 2 },
  catchError: atsRetryPolicy,
  run: async (payload: { target: any; policy: any }, { signal }) => {
    let policy;
    try { policy = validatePostingCheck(payload.policy); }
    catch { throw new AbortTaskRunError('Invalid published posting check policy'); }
    try { return await fetchAtsPosting({ target: payload.target, policy }, { signal }); }
    catch (error) {
      if (error && typeof error === 'object' && 'abort' in error) throw new AbortTaskRunError(error instanceof Error ? error.message : 'Unsupported request');
      throw error;
    }
  },
});
