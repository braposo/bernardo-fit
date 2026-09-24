import assert from 'node:assert/strict';
import {initialChatSettingsDocument} from '../lib/chat/settings-defaults.js';
import {chatSettingsFromDocument,loadChatSettings} from '../lib/chat/settings.js';
import {selectChatModel} from '../lib/chat/models.js';
import {createChatWork} from '../lib/chat/work.js';
import {createChatAgent} from '../lib/chat/agent.js';
import {classifyWithJev} from '../functions/classify-conversations/classifier.js';
import {MockLanguageModelV4} from 'ai/test';

let passed=0,failed=0;
async function test(name, fn) {try {await fn();passed++;console.log('ok '+name);}catch(e){failed++;console.error('FAIL '+name,e);}}
const document = ()=>({...initialChatSettingsDocument(),_rev:'revision-one'});
const request = {messages:[{role:'user',content:'A synthetic question'}],model:'auto',provider:'auto'};
const env = {OPENAI_API_KEY:'fake',ANTHROPIC_API_KEY:'fake',TYPESAFE_API_KEY:'fake'};

await test('published-only fetch rejects absent, draft, malformed and unavailable settings without fallback',async()=>{
  let options;
  const settings=await loadChatSettings({client:{fetch:async(query,params,opts)=>{assert.match(query,/_id == "fit-chat-settings"/);options=opts;return document();}}});
  assert.equal(options.perspective,'published');assert.equal(settings.revision,'revision-one');
  for (const doc of [null,{...document(),_id:'drafts.fit-chat-settings'},{...document(),_rev:undefined}])
    await assert.rejects(loadChatSettings({client:{fetch:async()=>doc}}),{code:'CHAT_SETTINGS_INVALID'});
  await assert.rejects(loadChatSettings({client:{fetch:async()=>{throw Error('credential/details');}}}),e=>e.code==='CHAT_SETTINGS_UNAVAILABLE'&&!e.message.includes('credential'));
});
await test('validation rejects unsafe providers, duplicate IDs, disabled catalogs, invalid budgets and classifier contracts',()=>{
  for (const mutate of [d=>d.models[0].provider='other',d=>d.models[1].id=d.models[0].id,d=>d.models.forEach(m=>m.enabled=false),
    d=>d.maxSteps=11,d=>d.maxOutputTokens=1,d=>d.confidenceThreshold=1.1,d=>d.assistantInstructions=' ',
    d=>d.classificationQuestions[0].criteria.pop(),d=>d.classificationQuestions[1].options[0].key='other',
    d=>d.classificationQuestions[2].key='constructor',d=>d.classificationQuestions[2].key='success']) {
    const doc=document();mutate(doc);assert.throws(()=>chatSettingsFromDocument(doc),{code:'CHAT_SETTINGS_INVALID'});
  }
});
await test('editable model IDs, provider mapping, Jev version, thresholds and priority determine routing',async()=>{
  const doc=document();doc.jevModel='jev-test';doc.routingInstructions='Custom routing';doc.models[0].enabled=false;
  doc.models[1].id='new-openai-model';doc.models[1].fallbackPriority=1;doc.confidenceThreshold=0.9;
  const settings=chatSettingsFromDocument(doc);let input;
  const route=await selectChatModel(request,{env,settings,evaluate:async args=>{input=args;return {answers:{model:{choice:'claude-sonnet-5',confidence:0.85,probabilities:{'claude-sonnet-5':0.99}}}};}});
  assert.equal(input.model,'jev-test');assert.equal(input.questions.model.instructions,'Custom routing');
  assert.ok(!Object.hasOwn(input.questions.model.criteria,'gpt-5.6-sol'));
  assert.equal(route.model,'new-openai-model');assert.equal(route.provider,'openai');assert.equal(route.settingsRevision,'revision-one');
  assert.equal(route.settingsFingerprint,settings.fingerprint);
});
await test('one immutable snapshot per turn; publishing changes only the next turn',async()=>{
  let doc=document(),loads=0;const observed=[];
  const work=createChatWork({env,loadSettings:async()=>{loads++;return chatSettingsFromDocument(doc);},
    admit:async()=>async()=>{},connect:async()=>({sources:new Map(),close:async()=>{}}),
    select:async(_,opts)=>{observed.push(opts.settings);doc={...doc,_rev:'revision-two',assistantInstructions:'Updated instructions'};return {model:'test',provider:'openai'};},
    makeAgent:({settings})=>{assert.equal(settings,observed.at(-1));return {stream:async()=>({stream:(async function*(){yield {type:'text-delta',text:settings.assistantInstructions};yield {type:'finish',finishReason:'stop'};})()})};}});
  const first=await work({request,requestId:'one'});const second=await work({request,requestId:'two'});
  assert.equal(loads,2);assert.equal(observed[0].revision,'revision-one');assert.equal(observed[1].revision,'revision-two');
  assert.notEqual(first.text,second.text);assert.equal(second.text,'Updated instructions');
  assert.throws(()=>observed[0].models.push({}));
});
await test('invalid settings stop before Context and paid routing',async()=>{
  let upstream=0;
  const work=createChatWork({env,loadSettings:async()=>{throw Object.assign(Error('Publish valid Chat settings'),{code:'CHAT_SETTINGS_INVALID'});},
    admit:async()=>async()=>{},connect:async()=>upstream++,select:async()=>upstream++});
  const result=await work({request,requestId:'invalid'});assert.equal(result.status,'failed');assert.equal(upstream,0);assert.match(result.error,/Publish valid/);
});
await test('agent passes published prompts and response limits to the actual SDK',async()=>{
  const settings=chatSettingsFromDocument({...document(),assistantInstructions:'Assistant prompt',contextInstructions:'Context prompt',maxOutputTokens:512,maxSteps:1});
  let options;
  const model=new MockLanguageModelV4({doStream:async input=>{options=input;return {stream:new ReadableStream({start(c){
    c.enqueue({type:'stream-start',warnings:[]});c.enqueue({type:'text-start',id:'t'});c.enqueue({type:'text-delta',id:'t',delta:'answer'});c.enqueue({type:'text-end',id:'t'});
    c.enqueue({type:'finish',finishReason:{unified:'stop',raw:'stop'},usage:{inputTokens:{total:1,noCache:1},outputTokens:{total:1,text:1}}});c.close();
  }})};}});
  const agent=createChatAgent({settings,route:{model:'test',provider:'openai'},ref:'fixture',context:{initialContext:'Schema',tools:{}},makeModel:()=>model,record:async()=>{}});
  const response=await agent.stream({messages:request.messages});for await(const part of response.stream)if(part.type==='error')throw part.error;
  assert.equal(options.maxOutputTokens,512);
  assert.ok(options.prompt[0].content.startsWith('Assistant prompt\n\nContext prompt\n\nSchema\n\n'));
  assert.match(options.prompt[0].content,/Do not add a Sources, References, or citations section/);
});
await test('Insights uses editable classifier prompts, model, gap labels and threshold',async()=>{
  const doc=document();doc.classifierModel='jev-custom';doc.gapThreshold=0.6;doc.classificationQuestions[0].instructions='Custom success rubric';
  doc.classificationQuestions[2].label='Edited gap label';const settings=chatSettingsFromDocument(doc);let body;
  const result=await classifyWithJev(request.messages,{settings,apiKey:'fake',fetchImpl:async(_,opts)=>{
    body=JSON.parse(opts.body);
    return Response.json({model:'jev-custom',answers:{success:{type:'score',score:8,probabilities:Object.fromEntries(Array.from({length:10},(_,i)=>[i,i===8?1:0]))},
      sentiment:{type:'choice',choice:'neutral',probabilities:{positive:0,neutral:1,negative:0}},
      ...Object.fromEntries(Object.keys(settings.gaps).map(key=>[key,{type:'noul',noul:key==='salary'?0.7:0.1}]))}});
  }});
  assert.equal(body.model,'jev-custom');assert.equal(body.questions.success.instructions,'Custom success rubric');assert.deepEqual(result.contentGaps,['Edited gap label']);
});
console.log(`passed ${passed}, failed ${failed}`);process.exitCode=failed?1:0;
