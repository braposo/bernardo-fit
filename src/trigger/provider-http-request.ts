import {task, AbortTaskRunError} from '@trigger.dev/sdk';
import {executeProviderRequest, requestRetryPolicy, assertActiveOwner} from '../../lib/provider-lifecycle.js';
import {validateRequestLifecycle, DEFAULT_REQUEST_LIFECYCLE} from '../../lib/sanity/request-lifecycle.js';

export const providerHttpRequest=task({
  id:'provider-http-request',maxDuration:300,retry:{maxAttempts:1},queue:{concurrencyLimit:6},
  catchError:requestRetryPolicy,
  run:async(payload:{provider:string;body:string;policy:any;ownerRunId:string},{signal})=>{
    try {
      if(!['jev','openai','anthropic'].includes(payload.provider))throw Error();
      validateRequestLifecycle({...DEFAULT_REQUEST_LIFECYCLE,[payload.provider]:payload.policy});
    } catch {throw new AbortTaskRunError('Invalid published provider policy');}
    await assertActiveOwner(payload.ownerRunId);
    return executeProviderRequest(payload,{signal});
  },
});
