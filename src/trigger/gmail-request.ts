import { task } from '@trigger.dev/sdk';
import { fetchGmail, gmailRetryPolicy } from '../../lib/gmail-source.js';
import { GMAIL_REQUEST_TASK_ID } from '../../lib/task-policy.js';

// One read-only Gmail request (a search or one message) per attempt. Trigger
// owns retries: 408/429/5xx and an expired access token are retried with
// backoff (or at Retry-After); a refused refresh token or a bad payload stops.
// The OAuth credentials are read inside the worker and URLs are built in code.
export const gmailRequest = task({
  id: GMAIL_REQUEST_TASK_ID, maxDuration: 120,
  retry: { maxAttempts: 4, minTimeoutInMs: 5_000, maxTimeoutInMs: 300_000, factor: 3, randomize: true },
  queue: { concurrencyLimit: 2 },
  catchError: gmailRetryPolicy,
  run: async (payload: { op: 'list'; query: string; maxResults: number } | { op: 'get'; id: string }, { signal }) =>
    fetchGmail(payload, { signal }),
});
