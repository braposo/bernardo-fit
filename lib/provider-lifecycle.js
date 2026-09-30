import { createHash } from 'node:crypto';
import { generationContext } from './generation-context.js';
import { analysisSettings, requestLifecycle } from './sanity/analysis-settings.js';
import { retryAfterDate } from './linkedin-request.js';

export const PROVIDERS = {
  jev:{url:'https://api.typesafe.ai/v1/systemone',key:'TYPESAFE_API_KEY'},
  openai:{url:'https://api.openai.com/v1/responses',key:'OPENAI_API_KEY'},
  anthropic:{url:'https://api.anthropic.com/v1/messages',key:'ANTHROPIC_API_KEY'},
};
export const callFingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function durableTask(id,payload,key,{maxAttempts=1,maxDuration}={}) {
  const {tasks,idempotencyKeys}=await import('@trigger.dev/sdk');
  const result=await tasks.triggerAndWait(id,payload,{
    idempotencyKey:await idempotencyKeys.create(key),idempotencyKeyTTL:'30d',maxAttempts,...(maxDuration?{maxDuration}:{}),
  });
  if(!result.ok)throw Object.assign(new Error(`${id} failed; inspect its Trigger run.`),{abort:true,retryable:false,childRunId:result.id});
  return result.output;
}

// A successful model task is reused on parent retries, including a failed first
// persistence write. Semantic repairs and continuations retain separate inputs.
export async function durableModelCall(provider,input,execute) {
  const context=generationContext();
  input.signal?.throwIfAborted();
  if(!context.runId || context.modelTask)return execute(input);
  const {signal,...args}=input;
  const settings=analysisSettings(), policy=requestLifecycle();
  return durableTask('durable-model-call',{provider,args,settings,policy,ownerRunId:context.ownerRunId || context.runId,
    attribution:{jobId:context.jobId,reportId:context.reportId}},
    ['model',provider,callFingerprint({args,settings:settings.fingerprint})]);
}

export function requestRetryPolicy({payload,error}) {
  if(error?.abort || error?.name==='AbortTaskRunError')return {skipRetrying:true};
  return {retry:payload.policy.retry,...(error?.retryAt?{retryAt:error.retryAt}:{})};
}
export async function assertActiveOwner(ownerRunId) {
  const {runs,AbortTaskRunError}=await import('@trigger.dev/sdk');
  if(typeof ownerRunId!=='string' || !ownerRunId || (await runs.retrieve(ownerRunId)).isCompleted)
    throw new AbortTaskRunError('The owning generation run is no longer active');
}
export function providerError(response) {
  const retryable=[408,409,429].includes(response.status)||response.status>=500;
  return Object.assign(new Error(`Provider request failed (HTTP ${response.status})`),{
    status:response.status,providerStatus:response.status,retryAt:retryAfterDate(response.headers?.get('retry-after')),
    ...(!retryable?{abort:true}:{}),
  });
}

// No credentials cross the Trigger payload boundary. Endpoints are fixed in code.
export async function executeProviderRequest({provider,body,policy},{signal,fetchRequest,env=process.env}={}) {
  signal?.throwIfAborted();
  const target=PROVIDERS[provider];
  if(!target || typeof body!=='string')throw Object.assign(new Error('Invalid provider request'),{abort:true});
  const credential=env[target.key]?.trim();
  if(!credential)throw Object.assign(new Error(`Configure ${target.key}`),{abort:true});
  const {retry}=await import('@trigger.dev/sdk');
  const response=await (fetchRequest||retry.fetch)(target.url,{
    method:'POST',redirect:'error',body,signal,timeoutInMs:policy.timeoutSeconds*1000,
    headers:{'Content-Type':'application/json',...(provider==='anthropic'
      ?{'x-api-key':credential,'anthropic-version':'2023-06-01'}:{Authorization:`Bearer ${credential}`})},
    retry:{byStatus:{},timeout:{maxAttempts:1},connectionError:{maxAttempts:1}},
  });
  if(!response.ok){const error=providerError(response);await response.body?.cancel();throw error;}
  return {status:response.status,body:await response.text()};
}

export async function providerFetch(provider,body,{signal}={}) {
  const context=generationContext(), policy=requestLifecycle()[provider];
  signal?.throwIfAborted();
  if(!context.runId) {
    // Standalone CLI / synchronous callers cannot use durable task waits. They
    // make one attempt under the caller deadline (or a bounded transport deadline).
    const target=PROVIDERS[provider], credential=process.env[target.key]?.trim();
    return fetch(target.url,{method:'POST',body,redirect:'error',
      signal:signal || AbortSignal.timeout(policy.timeoutSeconds*1000),
      headers:{'Content-Type':'application/json',...(provider==='anthropic'
        ?{'x-api-key':credential,'anthropic-version':'2023-06-01'}:{Authorization:`Bearer ${credential}`})}});
  }
  const payload={provider,body,policy,ownerRunId:context.ownerRunId || context.runId};
  const result=await durableTask('provider-http-request',payload,['http',provider,callFingerprint(body)],{maxAttempts:policy.retry.maxAttempts});
  return new Response(result.body,{status:result.status});
}

