import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createChatHandler, relayChatRun } from '../api/admin/chat.js';
let passed=0, failed=0;
const test=async(name,fn)=>{try{await fn();passed++;console.log('ok '+name);}catch(e){failed++;console.error('FAIL '+name,e);}};
process.env.ADMIN_SECRET='test-admin';
const request={requestId:'11111111-1111-4111-8111-111111111111',conversationId:'22222222-2222-4222-8222-222222222222',messages:[{role:'user',content:'Synthetic question'}]};
function exchange(method='POST',body=request,query={}) {
  const req=Object.assign(new EventEmitter(),{method,body,query,headers:{'x-admin-secret':'test-admin'}});
  const res=Object.assign(new EventEmitter(),{statusCode:200,output:'',setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;this.writableEnded=true;return this;},write(text){this.output+=text;return true;},end(){this.writableEnded=true;}});
  return {req,res};
}
function fixture() {
  const receipts=new Map(), runs=new Map(); let starts=0, failSave=true;
  const handler=createChatHandler({env:{ADMIN_CHAT_ENABLED:'1',ADMIN_CHAT_WORKER_READY:'1',TRIGGER_SECRET_KEY:'tr_dev_synthetic'},storage:true,
    key:async value=>value,
    trigger:async(id,payload,options)=>{if(!runs.has(options.idempotencyKey)){starts++;runs.set(options.idempotencyKey,{id:'run_one',taskIdentifier:id,payload,status:'EXECUTING'});}return {id:'run_one'};},
    retrieve:async()=>[...runs.values()][0],
    receiptForRequest:async()=>receipts.get('run_one'),receiptForRun:async id=>receipts.get(id),
    saveReceipt:async receipt=>{if(failSave){failSave=false;throw Error('redis disconnected');}receipts.set(receipt.runId,receipt);},
    cancel:async id=>{assert.equal(id,'run_one');[...runs.values()][0].status='CANCELED';},
    read:async()=> (async function*(){yield {seq:0,event:'text',data:{text:'Answer'}};yield {seq:1,event:'done',data:{status:'complete'}};})(),
  });return {handler,runs,receipts,starts:()=>starts};
}
await test('ambiguous dispatch recovers one task and binds the request content',async()=>{
  const f=fixture();const first=exchange();await f.handler(first.req,first.res);assert.equal(first.res.statusCode,503);
  const second=exchange();await f.handler(second.req,second.res);assert.equal(second.res.statusCode,202);assert.equal(f.starts(),1);
  const duplicate=exchange();await f.handler(duplicate.req,duplicate.res);assert.equal(duplicate.res.body.recovered,true);assert.equal(f.starts(),1);
  const different=exchange('POST',{...request,messages:[{role:'user',content:'Different'}]});await f.handler(different.req,different.res);assert.equal(different.res.statusCode,409);
  assert.equal([...f.runs.values()][0].payload.request.provider,'auto');
});
await test('only receipted chat runs can be read or cancelled',async()=>{
  const f=fixture();for(const method of ['GET','POST']){const x=exchange(method,{action:'stop',runId:'run_other'},{run:'run_other'});await f.handler(x.req,x.res);assert.equal(x.res.statusCode,404);}
  for(let i=0;i<2;i++){const x=exchange();await f.handler(x.req,x.res);}
  const stop=exchange('POST',{action:'stop',runId:'run_one'});await f.handler(stop.req,stop.res);assert.equal(stop.res.statusCode,202);
  const read=exchange('GET',null,{run:'run_one'});await f.handler(read.req,read.res);assert.match(read.res.output,/"status":"stopped"/);
});
await test('completed snapshot recovers the full response without reading an expired stream',async()=>{
  const x=exchange('GET',null,{cursor:'4'});
  await relayChatRun(x.req,x.res,'run_one',{retrieve:async()=>({status:'COMPLETED',output:{text:'Full answer',sources:[],status:'complete'}}),read:()=>{throw Error('must not read');}});
  assert.match(x.res.output,/Full answer/);assert.match(x.res.output,/event: done/);
});
await test('disconnect cancels only the subscription and resume forwards the chunk cursor',async()=>{
  const x=exchange('GET',null,{cursor:'7'});let signal;
  await relayChatRun(x.req,x.res,'run_one',{retrieve:async()=>({status:'EXECUTING',metadata:{phase:'reading'}}),read:async(id,key,options)=>{
    assert.equal(options.startIndex,7);signal=options.signal;
    return (async function*(){yield {seq:7,event:'text',data:{text:'Partial'}};x.res.destroyed=true;x.res.emit('close');signal.throwIfAborted();})();
  }});
  assert.ok(signal.aborted);assert.match(x.res.output,/Partial/);assert.ok(!x.res.output.includes('event: done'));
});
await test('worker crash produces a safe terminal failure instead of endless reconnection',async()=>{
  const x=exchange('GET');await relayChatRun(x.req,x.res,'run_one',{retrieve:async()=>({status:'CRASHED',error:{message:'SECRET'}})});
  assert.match(x.res.output,/"status":"failed"/);assert.ok(!x.res.output.includes('SECRET'));
});
await test('preview chat accepts only a named Development worker',async()=>{
  for (const [secret,branch,ready] of [['tr_dev_test','chat-branch',true],['tr_dev_test','',false],['tr_preview_test','chat-branch',false],['tr_prod_test','chat-branch',false]]) {
    const handler=createChatHandler({storage:true,env:{ADMIN_CHAT_WORKER_READY:'1',VERCEL_ENV:'preview',ADMIN_CHAT_TRIGGER_SECRET_KEY:secret,ADMIN_CHAT_TRIGGER_BRANCH:branch}});
    const x=exchange('GET',null);await handler(x.req,x.res);assert.equal(x.res.body.workerConfigured,ready);
  }
});
await test('production chat requires a Production key without a branch override',async()=>{
  for (const [secret,branch,ready] of [['tr_prod_test','',true],['tr_prod_test','chat-branch',false],['tr_dev_test','',false],['tr_preview_test','',false]]) {
    const handler=createChatHandler({storage:true,env:{ADMIN_CHAT_WORKER_READY:'1',VERCEL_ENV:'production',ADMIN_CHAT_TRIGGER_SECRET_KEY:secret,ADMIN_CHAT_TRIGGER_BRANCH:branch}});
    const x=exchange('GET',null);await handler(x.req,x.res);assert.equal(x.res.body.workerConfigured,ready);
  }
});
console.log(`passed ${passed}, failed ${failed}`);process.exitCode=failed?1:0;
