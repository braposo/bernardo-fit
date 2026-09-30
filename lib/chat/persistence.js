import {durableTask,callFingerprint} from '../provider-lifecycle.js';
import {generationContext} from '../generation-context.js';
import {requestLifecycle} from '../sanity/analysis-settings.js';
import {saveChatTurn} from './insights.js';

export async function persistChatTurn({env,...snapshot}) {
  if(!generationContext().runId)return saveChatTurn({...snapshot,env});
  const policy=requestLifecycle().storage;
  return durableTask('persist-chat-turn',{snapshot,policy},['chat-turn',snapshot.ref,callFingerprint(snapshot)],{
    maxAttempts:policy.retry.maxAttempts,maxDuration:policy.timeoutSeconds,
  });
}
