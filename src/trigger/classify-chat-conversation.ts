import { schemaTask, retry, AbortTaskRunError } from '@trigger.dev/sdk';
import { classificationClient } from '../../functions/classify-conversations/client.js';
import { classificationPayload, classifyConversation, recordClassificationFailure } from '../../functions/classify-conversations/classifier.js';

// Stage retries keep a failed Sanity write from repeating a successful paid Jev call.
export const retryStage = <T>(operation: () => Promise<T>) => retry.onThrow(async () => {
  try { return await operation(); }
  catch (error) {
    if (error instanceof Error && 'retryable' in error && error.retryable === false)
      throw new AbortTaskRunError(error.message);
    throw error;
  }
}, { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 5000, factor: 2, randomize: true });

export const classifyChatConversation = schemaTask({
  id: 'classify-chat-conversation',
  schema: classificationPayload,
  maxDuration: 300,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 1 },
  run: async payload => classifyConversation(classificationClient(), payload, { retryStage }),
  onFailure: async ({ payload }) => {
    await retryStage(() => recordClassificationFailure(classificationClient(), payload));
  },
});
