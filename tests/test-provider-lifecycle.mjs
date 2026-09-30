import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const realSdk=import.meta.resolve('@trigger.dev/sdk');
const definitions=new Map(),results=new Map();let calls=0,nextRun=0,outputText='Answer',status=200;
process.env.OPENAI_API_KEY='synthetic';process.env.TYPESAFE_API_KEY='synthetic';process.env.ANTHROPIC_API_KEY='synthetic';
let getContext=()=>({}),ownerCompleted=false;
globalThis.__lifecycle={
  runs:{retrieve:async()=>({isCompleted:ownerCompleted})},
  task:definition=>{definitions.set(definition.id,definition);return definition;},
  idempotencyKeys:{create:async key=>JSON.stringify([getContext().runId,key])},
  tasks:{triggerAndWait:async(id,payload,options)=>{
    assert.equal(JSON.stringify(payload).includes('synthetic'),false,'credentials must stay out of task payloads');
    const key=id+options.idempotencyKey;
    if(results.has(key))return structuredClone(results.get(key));
    let result;const definition=definitions.get(id),runId='child_'+(++nextRun);
    for(let attempt=1;attempt<=options.maxAttempts;attempt++) {
      try{result={ok:true,id:runId,output:await definition.run(payload,{ctx:{run:{id:runId},attempt:{number:attempt}},signal:new AbortController().signal})};break;}
      catch(error){result={ok:false,id:runId,error};const policy=definition.catchError?.({payload,error});if(policy?.skipRetrying)break;}
    }
    results.set(key,result);return structuredClone(result);
  }},
  retry:{fetch:async(url,init)=>{
    calls++;assert.equal(init.retry.timeout.maxAttempts,1);assert.equal(init.retry.connectionError.maxAttempts,1);
    assert.ok(init.signal);assert.ok(init.timeoutInMs>0);
    const body=JSON.parse(init.body);
    if(status!==200)return new Response('',{status,headers:{'retry-after':'60'}});
    if(url.includes('typesafe'))return Response.json({model:'jev-1.13.0',answers:{q:{type:'noul',noul:0.9}},usage:{input_tokens:10}});
    return Response.json({model:body.model,status:'completed',output:[{type:'message',content:[{type:'output_text',text:outputText}]}],usage:{input_tokens:10,output_tokens:10}});
  }},
};
const hook=registerHooks({resolve(specifier,context,next){return specifier==='@trigger.dev/sdk'?{url:'test:lifecycle-sdk',shortCircuit:true}:next(specifier,context);},
  load(url,context,next){return url==='test:lifecycle-sdk'?{format:'module',shortCircuit:true,source:`export * from ${JSON.stringify(realSdk)}; export const {task,tasks,idempotencyKeys,retry,runs}=globalThis.__lifecycle;`}:next(url,context);}});
const {withChildGenerationContext,generationContext}=await import('../lib/generation-context.js');getContext=generationContext;
await import('../src/trigger/provider-http-request.ts');await import('../src/trigger/durable-model-call.ts');
const {runAnalysis}=await import('../lib/analyze.js');
const {runCoverLetter}=await import('../lib/cover.js');
const {runAnswer}=await import('../lib/answer.js');
const {evaluateJev}=await import('../lib/jev.js');
const {executeProviderRequest,requestRetryPolicy}=await import('../lib/provider-lifecycle.js');
const {DEFAULT_REQUEST_LIFECYCLE,validateRequestLifecycle}=await import('../lib/sanity/request-lifecycle.js');
const {settingsFromDocument,withSettingsSnapshot}=await import('../lib/sanity/analysis-settings.js');
const {initialSettingsDocument}=await import('../lib/sanity/settings-document.js');
let passed=0,failed=0;
async function test(name,run){try{calls=0;status=200;results.clear();await withChildGenerationContext({runId:name},run);passed++;console.log('ok '+name);}catch(error){failed++;console.error('FAIL',name,error);}}
const report={job_title:'Engineer',company:'Example',pitch:'Fit',categories:[],differentiators:[],closing:'End'};
const args={report,model:'gpt-5.6-sol',ref:'request-1',fitUrl:'https://example.com/fit',question:'Describe your leadership approach',jobDescription:'Lead an engineering team building useful software',limit:120};
for(const kind of ['analysis','cover','answer'])await test(`${kind} failed first save reuses completed generation`,async()=>{
  outputText=kind==='analysis'?JSON.stringify(report):kind==='cover'?JSON.stringify({salutation:'Dear team,',paragraphs:[{lead:true,text:'I have led engineering teams.'}]}):'I have led engineering teams.';
  const generate=()=>kind==='analysis'?runAnalysis(args.jobDescription,args):kind==='cover'?runCoverLetter(args):runAnswer(args);
  let saves=0;
  const work=async()=>{const value=await generate();if(++saves===1)throw Error('Sanity unavailable');return value;};
  await assert.rejects(work(),/Sanity unavailable/);
  assert.ok(await work());assert.equal(calls,1);assert.equal(saves,2);
});
await test('Jev native attempts do not multiply on parent retries',async()=>{
  status=429;const args={state:{},questions:{q:{type:'boolean',instructions:'Is it relevant?'}},kind:'test',ref:'rate-limit'};
  await assert.rejects(evaluateJev(args));assert.equal(calls,3);
  await assert.rejects(evaluateJev(args));assert.equal(calls,3);
});
await test('provider permanent failures abort and retry dates survive',async()=>{
  for(const code of [401,429,529]) {
    await assert.rejects(executeProviderRequest({provider:'jev',body:'{}',policy:DEFAULT_REQUEST_LIFECYCLE.jev},{
      fetchRequest:async()=>new Response('',{status:code,headers:{'retry-after':'120'}})
    }),error=>{
      const policy=requestRetryPolicy({payload:{policy:DEFAULT_REQUEST_LIFECYCLE.jev},error});
      assert.equal(error.providerStatus,code);
      if(code===401)assert.equal(policy.skipRetrying,true);else assert.ok(policy.retryAt.getTime()>Date.now()+119000);
      return true;
    });
  }
});
await test('cancellation prevents HTTP and timeout delegates without nested attempts',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(executeProviderRequest({provider:'jev',body:'{}',policy:DEFAULT_REQUEST_LIFECYCLE.jev},{signal:controller.signal,fetchRequest:()=>assert.fail('cancelled')}));
  let attempts=0;
  await assert.rejects(executeProviderRequest({provider:'jev',body:'{}',policy:DEFAULT_REQUEST_LIFECYCLE.jev},{fetchRequest:async(_,options)=>{
    attempts++;assert.equal(options.timeoutInMs,30000);assert.equal(options.retry.timeout.maxAttempts,1);throw new DOMException('Timed out','AbortError');
  }}));assert.equal(attempts,1);
});
await test('published policy changes requests without invalidating fit evidence',async()=>{
  const doc=initialSettingsDocument(),original=settingsFromDocument(doc);
  doc.requestLifecycle.jev.timeoutSeconds=45;doc.requestLifecycle.jev.retry.maxAttempts=2;
  const changed=settingsFromDocument(doc);assert.equal(changed.fingerprint,original.fingerprint);
  status=529;
  await withSettingsSnapshot(changed,()=>assert.rejects(evaluateJev({state:{},questions:{q:{type:'boolean'}},kind:'test',ref:'edited'})));
  assert.equal(calls,2);
  for(const value of [0,6])assert.throws(()=>validateRequestLifecycle({...doc.requestLifecycle,jev:{...doc.requestLifecycle.jev,retry:{...doc.requestLifecycle.jev.retry,maxAttempts:value}}}));
});
for(const outcome of ['complete','stopped'])await test(`storage retries preserve ${outcome} snapshots without replaying generation`,async()=>{
  const {persistChatTurn}=await import('../lib/chat/persistence.js');let saves=0,modelCalls=0;
  definitions.set('persist-chat-turn',{run:async({snapshot})=>{assert.equal(snapshot.ref,'turn-1');assert.equal(snapshot.outcome,outcome);if(++saves===1)throw Error('temporary save');return {saved:true};}});
  modelCalls++;const snapshot={request:{messages:[{role:'user',content:'Hi'}]},ref:'turn-1',text:'Saved reply',outcome,env:{TOKEN:'synthetic'}};
  assert.deepEqual(await persistChatTurn(snapshot),{saved:true});assert.equal(modelCalls,1);assert.equal(saves,2);
  await persistChatTurn(snapshot);assert.equal(saves,2);
});
await test('queued model work stops when the owning run has been cancelled',async()=>{
  ownerCompleted=true;
  try {await assert.rejects(runAnalysis(args.jobDescription,args));assert.equal(calls,0);}
  finally {ownerCompleted=false;}
});
hook.deregister();delete globalThis.__lifecycle;
console.log(`passed ${passed}, failed ${failed}`);process.exitCode=failed?1:0;
