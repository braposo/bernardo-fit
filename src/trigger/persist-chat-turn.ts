import {task,AbortTaskRunError} from '@trigger.dev/sdk';
import {saveChatTurn,insightsClient} from '../../lib/chat/insights.js';
import {requestRetryPolicy} from '../../lib/provider-lifecycle.js';
import {DEFAULT_REQUEST_LIFECYCLE,validateRequestLifecycle} from '../../lib/sanity/request-lifecycle.js';

export const persistChatTurn=task({
  id:'persist-chat-turn',maxDuration:240,retry:{maxAttempts:3},queue:{concurrencyLimit:3},
  catchError:requestRetryPolicy,
  run:async(payload:{snapshot:any;policy:any},{signal})=>{
    validateRequestLifecycle({...DEFAULT_REQUEST_LIFECYCLE,storage:payload.policy});
    if(!payload.snapshot?.ref || !payload.snapshot?.request)throw new AbortTaskRunError('Invalid chat snapshot');
    try {
      // Trigger maxDuration owns the write timeout. No SDK retry/timeout layer.
      await saveChatTurn({...payload.snapshot,signal,client:insightsClient(process.env,{timeout:0})});
      return {saved:true};
    } catch(error) {
      const status=error && typeof error==='object' && 'statusCode' in error?Number(error.statusCode):0;
      if(status>=400&&status<500&&![408,409,429].includes(status))throw new AbortTaskRunError('Chat storage rejected the snapshot');
      throw error;
    }
  },
});
