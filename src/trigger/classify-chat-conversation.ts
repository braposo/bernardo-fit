import {withGenerationContext} from '../../lib/generation-context.js';
import {providerFetch} from '../../lib/provider-lifecycle.js';
import {requestLifecycle} from '../../lib/sanity/analysis-settings.js';
import { schemaTask, retry, AbortTaskRunError } from '@trigger.dev/sdk';
import { classificationClient } from '../../functions/classify-conversations/client.js';
import { classificationPayload, classifyWithJev, classifyConversation, recordClassificationFailure } from '../../functions/classify-conversations/classifier.js';

// Stage retries keep a failed Sanity write from repeating a successful paid Jev call.
export const retryStage = <T>(operation: () => Promise<T>) => retry.onThrow(async () => {
  try { return await operation(); }
  catch (error) {
    if (error instanceof Error && 'retryable' in error && error.retryable === false)
      throw new AbortTaskRunError(error.message);
    throw error;
  }
}, requestLifecycle().storage.retry);

export const classifyChatConversation = schemaTask({
  id: 'classify-chat-conversation',
  schema: classificationPayload,
  maxDuration: 300,
  retry: { maxAttempts: 1 },
  queue: { concurrencyLimit: 1 },
  run: async (payload,{ctx,signal}) => withGenerationContext({runId:ctx.run.id,taskAttempt:ctx.attempt.number},()=>
    classifyConversation(classificationClient(), payload, {retryStage,
      classify:(messages:any,options:any)=>classifyWithJev(messages,{...options,signal,
        fetchImpl:(_url:any,init:any)=>providerFetch('jev',init.body,{signal})}),
    })),
  onFailure: async ({ payload }) => {
    await withGenerationContext({},()=>retryStage(() => recordClassificationFailure(classificationClient(), payload)));
  },
});
