import assert from 'node:assert/strict';
import { wait } from '@trigger.dev/sdk';
import { dispatchPending, CLASSIFICATION_TASK_ID } from '../functions/classify-conversations/dispatch.js';
import { classifyConversation, classifyWithJev, recordClassificationFailure, classificationPayload } from '../functions/classify-conversations/classifier.js';
import { retryStage } from '../src/trigger/classify-chat-conversation.ts';

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('ok ' + name); } catch (error) { failed++; console.error('FAIL ' + name, error); } }
const originalWait = wait.until;
wait.until = async () => {}; // Exercise SDK retry logic without wall-clock waits or a worker.
const threadId = 'admin-chat.test';
const metrics = { successScore: 8, sentiment: 'neutral', contentGaps: [] };
const settings = { revision: 'published-rev', classifierModel: 'jev-test', questions: {} };
const snapshot = { messages: [{ role: 'user', content: 'PRIVATE TRANSCRIPT' }], metadata: { mcpEndpoints: ['bernardo-fit-admin'] } };
function fixture() {
  const writes = [];
  return { writes, config: () => ({ context: { organizationId: 'org' } }), context: {
    fetch: async (query, params) => {
      assert.match(query, /!defined\(classifiedAt\).*?&& !defined\(classificationError\)/s);
      assert.match(query, /order\(messagesUpdatedAt asc\)\[0\.\.\.3\]/);
      assert.equal(params.endpoint, 'bernardo-fit-admin');
      assert.ok(Math.abs(Date.now() - Date.parse(params.before) - 600000) < 2000);
      return [{ threadId }, { threadId: 'admin-chat.other' }];
    },
    conversations: { get: async () => snapshot, classify: async value => writes.push(value) },
  } };
}
const options = { loadSettings: async () => settings, classify: async () => metrics, retryStage };

await test('hourly dispatch is idempotent across ticks, sends IDs only and leaves acceptance failures pending', async () => {
  const client = fixture(), calls = [], handles = new Map();
  const trigger = async (id, payload, opts) => {
    calls.push({ id, payload, opts });
    if (payload.threadId === 'admin-chat.other') throw Error('PRIVATE ERROR');
    const key = String(opts.idempotencyKey);
    if (!handles.has(key)) handles.set(key, { id: 'run-one' });
    return handles.get(key);
  };
  const first = await dispatchPending(client, trigger), second = await dispatchPending(client, trigger);
  assert.deepEqual(first, { dispatched: 1, failed: 1, found: 2, runIds: ['run-one'] });
  assert.deepEqual(first, second);
  assert.equal(handles.size, 1);
  assert.equal(String(calls[0].opts.idempotencyKey), String(calls[2].opts.idempotencyKey));
  assert.notEqual(String(calls[0].opts.idempotencyKey), String(calls[1].opts.idempotencyKey));
  assert.equal(calls[0].opts.idempotencyKeyTTL, '30d');
  assert.equal(calls[0].id, CLASSIFICATION_TASK_ID);
  assert.deepEqual(calls[0].payload, { threadId });
  assert.equal(client.writes.length, 0);
});

await test('write retries retain the successful Jev result', async () => {
  const client = fixture(); let paid = 0, writes = 0;
  client.context.conversations.classify = async value => {
    writes++; if (writes < 3) throw Object.assign(Error('PRIVATE ERROR'), { statusCode: 503 });
    client.writes.push(value);
  };
  const result = await classifyConversation(client, { threadId }, { ...options, classify: async () => { paid++; return metrics; } });
  assert.deepEqual(result, { status: 'classified', settingsRevision: 'published-rev' });
  assert.equal(paid, 1); assert.equal(writes, 3);
  assert.deepEqual(client.writes, [{ threadId, coreMetrics: metrics }]);
});

await test('temporary Jev failures have three bounded attempts and terminal failure is stored separately', async () => {
  const client = fixture(); let attempts = 0;
  await assert.rejects(classifyConversation(client, { threadId }, { ...options, classify: async () => {
    attempts++; throw Object.assign(Error('Safe failure'), { retryable: true });
  } }));
  assert.equal(attempts, 3); assert.equal(client.writes.length, 0);
  await recordClassificationFailure(client, { threadId });
  assert.match(client.writes[0].classificationError, /Review the Trigger run/);
  assert.ok(!JSON.stringify(client.writes).includes('PRIVATE'));
});

await test('retries recover a temporary provider failure without reloading settings', async () => {
  const client = fixture(); let calls = 0, loads = 0;
  const result = await classifyConversation(client, { threadId }, { ...options,
    loadSettings: async () => { loads++; return settings; },
    classify: async (messages, {settings: actual}) => {
      assert.equal(actual, settings); assert.equal(messages, snapshot.messages);
      if (++calls === 1) throw Object.assign(Error('temporary'), {retryable:true});
      return metrics;
    },
  });
  assert.equal(result.status, 'classified'); assert.equal(calls, 2); assert.equal(loads, 1);
  assert.equal(client.writes.length, 1);
});

await test('storage failures are sanitized and a successful ambiguous write survives the failure hook', async () => {
  const client = fixture(); let reads = 0;
  client.context.conversations.get = async () => { reads++; throw Object.assign(Error('PRIVATE ERROR'), {statusCode:403}); };
  await assert.rejects(classifyConversation(client, {threadId}, options), /Insights storage request failed/);
  assert.equal(reads, 1); assert.equal(client.writes.length, 0);
  client.context.conversations.get = async () => ({...snapshot, classifiedAt:'now'});
  await recordClassificationFailure(client, {threadId});
  assert.equal(client.writes.length, 0);
});

await test('Jev 429 and 5xx are retryable; permanent HTTP and malformed outputs stop immediately', async () => {
  for (const status of [400, 401, 429, 500, 503]) {
    let calls = 0;
    await assert.rejects(retryStage(() => classifyWithJev(snapshot.messages, { apiKey: 'fake', settings,
      fetchImpl: async () => { calls++; return { ok: false, status }; },
    })), /Jev classification request failed/);
    assert.equal(calls, status === 429 || status >= 500 ? 3 : 1);
  }
  await assert.rejects(classifyWithJev(snapshot.messages, { apiKey: 'fake', settings,
    fetchImpl: async () => { throw Error('PRIVATE ERROR'); },
  }), error => error.retryable === true && !error.message.includes('PRIVATE'));
  await assert.rejects(classifyWithJev(snapshot.messages, { apiKey: 'fake', settings,
    fetchImpl: async () => ({ ok: true, json: async () => ({ model: 'wrong' }) }),
  }), error => error.retryable === false);
});

await test('completed or failed snapshots skip Jev, and terminal hooks never overwrite a verdict', async () => {
  for (const state of [{ classifiedAt: 'now' }, { classificationError: 'failed' }]) {
    const client = fixture(); client.context.conversations.get = async () => ({ ...snapshot, ...state });
    const result = await classifyConversation(client, { threadId }, { ...options, classify: () => { throw Error('must not run'); } });
    assert.equal(result.status, 'skipped');
    await recordClassificationFailure(client, { threadId });
    assert.equal(client.writes.length, 0);
  }
});

await test('missing and unrelated snapshots cannot be classified', async () => {
  const client = fixture();
  client.context.conversations.get = async () => null;
  assert.equal((await classifyConversation(client, { threadId }, options)).status, 'missing');
  client.context.conversations.get = async () => ({ ...snapshot, metadata: {} });
  await assert.rejects(classifyConversation(client, { threadId }, options), /outside admin chat/);
  await recordClassificationFailure(client, { threadId });
  assert.equal(client.writes.length, 0);
  assert.throws(() => classificationPayload({ threadId: 'another-thread' }));
  assert.deepEqual(classificationPayload({ threadId, messages: ['ignored'] }), { threadId });
});

wait.until = originalWait;
console.log(`passed ${passed}, failed ${failed}`);
process.exitCode = failed ? 1 : 0;
