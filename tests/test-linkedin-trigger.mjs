import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DEFAULT_LINKEDIN_SETTINGS as policy } from '../lib/sanity/linkedin-settings.js';
let owner='run_parent',terminal=false,status=200,events=[];
const signal=new AbortController().signal;
globalThis.__linkedinTest={
  task:config=>config,
  wait:{for:async options=>events.push(['pace',options]),until:async options=>events.push(['cooldown',options])},
  runs:{retrieve:async()=>({isCompleted:terminal})},
  retry:{fetch:async(_,options)=>{events.push(['fetch',options]);return new Response(status===200?'public results':'',{status,headers:{'retry-after':'600'}});}},
  kv:async()=>({get:async()=>owner}),
};
const hooks=registerHooks({
  resolve(specifier,context,next){
    if(specifier==='@trigger.dev/sdk')return {url:'test:trigger',shortCircuit:true};
    const resolved=next(specifier,context);
    if(resolved.url.endsWith('/lib/kv.js'))return {url:'test:kv',shortCircuit:true};
    return resolved;
  },
  load(url,context,next){
    if(url==='test:trigger')return {format:'module',shortCircuit:true,source:`export const {task,wait,runs,retry}=globalThis.__linkedinTest; export class AbortTaskRunError extends Error {name='AbortTaskRunError';}`};
    if(url==='test:kv')return {format:'module',shortCircuit:true,source:'export const {kv}=globalThis.__linkedinTest;'};
    return next(url,context);
  }
});
const {linkedinPublicRequest:task}=await import('../src/trigger/linkedin-public-request.ts');
let passed=0,failed=0;
async function test(name,fn){try{events=[];owner='run_parent';terminal=false;status=200;await fn();passed++;}catch(error){failed++;console.error('FAIL',name,error);}}
const payload={url:'https://www.linkedin.com/jobs/search/',ownerRunId:'run_parent',policy};
const run=attempt=>task.run(payload,{signal,ctx:{attempt:{number:attempt}}});
await test('worker makes requests without routine delay and passes native cancellation',async()=>{
  assert.equal((await run(1)).body,'public results');
  assert.deepEqual(events.map(event=>event[0]),['fetch']);
  assert.equal(events[0][1].signal,signal);
});
await test('canceled parent prevents further HTTP requests',async()=>{
  terminal=true;await assert.rejects(run(1),{name:'AbortTaskRunError'});assert.equal(events.length,0);
});
await test('lost ownership prevents further HTTP requests',async()=>{
  owner='another';await assert.rejects(run(1),{name:'AbortTaskRunError'});assert.equal(events.length,0);
});
await test('retryable attempt delegates backoff to catchError',async()=>{
  status=429;await assert.rejects(run(1),error=>{
    const config=task.catchError({payload,error});assert.deepEqual(config.retry,policy.retry);assert.ok(config.retryAt instanceof Date);return true;
  });assert.deepEqual(events.map(event=>event[0]),['fetch']);
});
await test('final failure retains ownership through provider cooldown using native wait',async()=>{
  status=429;await assert.rejects(run(4));assert.deepEqual(events.map(event=>event[0]),['fetch','cooldown']);
  assert.ok(events[1][1].date.getTime()>Date.now()+590000);
});
hooks.deregister();delete globalThis.__linkedinTest;
console.log(`passed ${passed}, failed ${failed}`);process.exitCode=failed?1:0;
