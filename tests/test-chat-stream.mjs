import assert from 'node:assert/strict';
import { readChatStream, historyForTurns } from '../src/admin/chat/stream.js';
let passed=0, failed=0;
async function test(name, fn) { try { await fn(); passed++; console.log('ok '+name); } catch(e) { failed++; console.error('FAIL '+name,e); } }
const response = text => new Response(new ReadableStream({start(controller) {
  for(const byte of new TextEncoder().encode(text)) controller.enqueue(new Uint8Array([byte])); controller.close();
}}), {headers:{'content-type':'text/event-stream'}});
await test('parses split UTF-8, CRLF, comments and multiple events', async()=>{
  const events=[];
  await readChatStream(response(': ping\r\n\r\nevent: text\r\ndata: {"text":"€ café"}\r\n\r\nevent: done\ndata: {}\n\n'),(event,data)=>events.push({event,data}));
  assert.deepEqual(events,[{event:'text',data:{text:'€ café'}},{event:'done',data:{}}]);
});
await test('rejects incomplete, failed, malformed and non-stream responses',async()=>{
  await assert.rejects(readChatStream(response('event: text\ndata: {"text":"partial"}\n\n'),()=>{}), /ended before/);
  await assert.rejects(readChatStream(response('event: error\ndata: {"error":"Unavailable"}\n\n'),()=>{}), /Unavailable/);
  await assert.rejects(readChatStream(response('event: text\ndata: invalid\n\n'),()=>{}));
  await assert.rejects(readChatStream(new Response('{}'),()=>{}),/unexpected/);
});
await test('history excludes incomplete attempts and enforces server limits',()=>{
  assert.deepEqual(historyForTurns([{question:'old',text:'partial',status:'failed'},{question:'Q',text:'A',status:'complete'}],'next'),
    [{role:'user',content:'Q'},{role:'assistant',content:'A'},{role:'user',content:'next'}]);
  assert.throws(()=>historyForTurns([],'x'.repeat(12001)),/limit/);
  assert.throws(()=>historyForTurns(Array.from({length:20},()=>({question:'Q',text:'A',status:'complete'})),'next'),/limit/);
});
console.log(`passed ${passed}, failed ${failed}`); process.exitCode=failed?1:0;
