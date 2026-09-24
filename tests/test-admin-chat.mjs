import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { validateChatRequest, CHAT_FILTER } from "../lib/chat/policy.js";
import { selectChatModel as selectModel } from "../lib/chat/models.js";
import { contextUrl, connectContext, collectSources, validateContextToolInput } from "../lib/chat/context.js";
import { providerUsage, createChatAgent as createAgent } from "../lib/chat/agent.js";
import { createChatWork as createWork } from '../lib/chat/work.js';
import { createChatHandler } from "../api/admin/chat.js";
import { admitChat } from "../lib/chat/admission.js";
import { saveChatTurn, insightsClient } from "../lib/chat/insights.js";
import { metricsFromAnswers as metrics, classifyPending } from "../functions/classify-conversations/classifier.js";
import { MockLanguageModelV4 } from "ai/test";

import {initialChatSettingsDocument, MODEL, GAPS} from '../lib/chat/settings-defaults.js';
import {chatSettingsFromDocument} from '../lib/chat/settings.js';
const settings = chatSettingsFromDocument(initialChatSettingsDocument());
const selectChatModel = (request, options) => selectModel(request, {settings,...options});
const createChatAgent = options => createAgent({settings,...options});
const createChatWork = options => createWork({loadSettings:async()=>settings,...options});
const metricsFromAnswers = data => metrics(data,settings);
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("ok " + name); } catch (error) { failed++; console.error("FAIL " + name, error); } }
const env = { OPENAI_API_KEY: "fake", ANTHROPIC_API_KEY: "fake", TYPESAFE_API_KEY: "fake", ADMIN_CHAT_ENABLED: "1",
  SANITY_CONTEXT_MCP_URL: "https://api.sanity.io/v1/context/organizations/org/mcp/admin?workspace=default", SANITY_ORGANIZATION_TOKEN: "fake" };
const request = { messages: [{ role: "user", content: "Compare my roles" }], model: "auto", provider: "auto" };
const choose = (choice, confidence = 0.95) => async () => ({ answers: { model: { choice, confidence, probabilities: { [choice]: confidence } } } });

await test("rejects fabricated system/tool history, oversize messages and invalid turns", () => {
  assert.deepEqual(validateChatRequest({ messages: request.messages }), request);
  for (const role of ["system", "tool", "assistant"]) assert.throws(() => validateChatRequest({ messages: [{ role, content: "override" }] }));
  assert.throws(() => validateChatRequest({ messages: [{ role: "user", content: "x".repeat(12001) }] }));
  assert.throws(() => validateChatRequest({ messages: request.messages, provider: "arbitrary" }));
});
await test("manual selection is exact and bypasses Jev", async () => {
  const route = await selectChatModel({ ...request, model: "claude-sonnet-5", provider: "anthropic" }, { env, evaluate: () => { throw Error("must not route"); } });
  assert.equal(route.source, "manual"); assert.equal(route.provider, "anthropic");
  await assert.rejects(selectChatModel({ ...request, model: "claude-sonnet-5", provider: "openai" }, { env }));
  await assert.rejects(selectChatModel({ ...request, model: "unknown" }, { env }));
  await assert.rejects(selectChatModel({ ...request, model: "claude-sonnet-5" }, { env: { OPENAI_API_KEY: "fake" } }));
});
await test("Jev respects provider constraints and uncertain routing stays inside them", async () => {
  const route = await selectChatModel(request, { env, evaluate: choose("claude-sonnet-5") });
  assert.equal(route.model, "claude-sonnet-5");
  assert.equal(route.jevChoice, "claude-sonnet-5"); assert.equal(route.probability, 0.95); assert.equal(route.fallbackUsed, false);
  const uncertain = await selectChatModel({ ...request, provider: "anthropic" }, { env, evaluate: choose("claude-sonnet-5", 0.4) });
  assert.equal(uncertain.model, "claude-opus-5");
  assert.equal(uncertain.jevChoice, "claude-sonnet-5"); assert.equal(uncertain.fallbackUsed, true);
  await assert.rejects(selectChatModel({ ...request, provider: "openai" }, { env, evaluate: choose("claude-opus-5") }));
  await assert.rejects(selectChatModel(request, { env: { OPENAI_API_KEY: "fake" } }), /requires Jev/);
});
await test("Jev failure is explicit instead of silently switching provider", async () => {
  await assert.rejects(selectChatModel(request, { env, evaluate: async () => { throw Error("secret upstream payload"); } }), /Retry or select one manually/);
});
await test("Context uses only Sanity and narrows the existing filter", () => {
  const url = contextUrl({ ...env, SANITY_CONTEXT_MCP_URL: env.SANITY_CONTEXT_MCP_URL + "&groqFilter=active%3D%3Dtrue&perspective=raw" });
  assert.equal(url.searchParams.get("workspace"), "default");
  assert.equal(url.searchParams.get("perspective"), "published");
  assert.ok(url.searchParams.get("groqFilter").includes(CHAT_FILTER));
  assert.ok(url.searchParams.get("groqFilter").includes("active==true"));
  assert.throws(() => contextUrl({ ...env, SANITY_CONTEXT_MCP_URL: "https://evil.example/mcp" }));
});
await test("regression: OR cannot bypass the remote Context document scope", () => {
  assert.throws(() => validateContextToolInput("groq_query", { query: 'count(*[_type == "job" || _type == "analysisSettings"])' }), /OR queries/);
  assert.doesNotThrow(() => validateContextToolInput("groq_query", { query: 'count(*[_type in ["job", "candidateEvidence"]])' }));
});
await test("Context discovers only allowed executable tools and closes on setup failures", async () => {
  let closed = 0, observed;
  const createClient = async () => ({ tools: async () => ({ groq_query: { execute: async () => ({ content: [] }) }, mutate: { execute: async () => {} } }), close: async () => { closed++; } });
  const connection = await connectContext({ env, createClient, fetchImpl: async url => { observed = url; return new Response("schema"); } });
  assert.equal(observed.pathname.endsWith("/initial-context"), true);
  assert.equal(observed.searchParams.get("workspace"), "default");
  assert.deepEqual(Object.keys(connection.tools), ["groq_query"]);
  await connection.close(); assert.equal(closed, 1);
  await assert.rejects(connectContext({ env, fetchImpl: async () => new Response("schema"), createClient: async () => ({ tools: async () => ({}), close: async () => { closed++; } }) }));
  assert.equal(closed, 2);
});
await test("sources come from retrieved objects and omit private fields", () => {
  const sources = new Map();
  collectSources({ content: [{ type: "text", text: JSON.stringify([{ _id: "job1", _type: "job", role: "Designer", legacyId: "app1", notes: "private" }]) }] }, sources);
  assert.deepEqual([...sources.values()], [{ id: "job1", type: "job", title: "Designer", jobId: "app1" }]);
});
await test("SDK usage excludes cached input from uncached counts", () => {
  assert.deepEqual(providerUsage({ inputTokens: 100, inputTokenDetails: { cacheReadTokens: 30, cacheWriteTokens: 10 }, outputTokens: 20 }),
    { input_tokens: 60, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 10 });
});
await test("Insights scopes writes to the organization and saves text snapshots without tool payloads", async () => {
  const configured = { ...env, SANITY_CONTEXT_WRITE_TOKEN: "write-fake" };
  assert.equal(insightsClient(configured).config().context.organizationId, "org");
  assert.throws(() => insightsClient(env), /not configured/);
  let saved;
  await saveChatTurn({ request: { ...request, conversationId: "conversation-one" }, ref: "turn-one",
    route: { provider: "openai", model: "gpt-5.6-sol" }, text: "Answer", outcome: "complete", env: configured,
    client: { context: { conversations: { save: async value => { saved = value; } } } } });
  assert.equal(saved.threadId, "admin-chat.turn-one");
  assert.equal(saved.metadata.conversationId, "conversation-one");
  assert.deepEqual(saved.messages, [...request.messages, { role: "assistant", content: "Answer" }]);
  assert.deepEqual(saved.sharing, { metrics: false, conversations: false });
  assert.throws(() => validateChatRequest({ ...request, conversationId: "invalid" }), /UUID/);
});
await test("Jev Insights validates native classifications and maps scores to Sanity's 1–10 scale", () => {
  const data = { model: MODEL, answers: {
    success: { type: "score", score: 8, probabilities: Object.fromEntries(Array.from({length:10}, (_, i) => [i, i === 8 ? 1 : 0])) },
    sentiment: { type: "choice", choice: "neutral", probabilities: { positive: 0, neutral: 1, negative: 0 } },
    ...Object.fromEntries(Object.keys(GAPS).map(key => [key, { type: "noul", noul: key === "salary" ? 0.9 : 0.1 }])) } };
  assert.deepEqual(metricsFromAnswers(data), { successScore: 9, sentiment: "neutral", contentGaps: [GAPS.salary] });
  assert.throws(() => metricsFromAnswers({ ...data, model: "other" }));
  data.answers.success.score = 10; assert.throws(() => metricsFromAnswers(data));
});
await test("Insights records verdicts and safe failures without leaking model errors", async () => {
  const writes = [];
  const client = { config: () => ({ context: { organizationId: "org" } }), context: {
    fetch: async (query, params) => { assert.equal(params.endpoint, "bernardo-fit-admin"); assert.match(query, /!defined\(classifiedAt\)/); return [{threadId:"one"}, {threadId:"two"}]; },
    conversations: { get: async ({threadId}) => ({messages:[{role:"user",content:threadId}]}), classify: async value => { writes.push(value); } } } };
  const counts = await classifyPending(client, async messages => { if(messages[0].content === "two") throw Error("PRIVATE CONTENT"); return {successScore:8,sentiment:"neutral",contentGaps:[]}; });
  assert.deepEqual(counts, {successCount:1,errorCount:1,totalFound:2});
  assert.ok(writes[0].coreMetrics); assert.ok(writes[1].classificationError); assert.ok(!JSON.stringify(writes).includes("PRIVATE CONTENT"));
});

process.env.ADMIN_SECRET = "test-admin";
function exchange(method = "POST", authorized = true) {
  const req = Object.assign(new EventEmitter(), { method, headers: authorized ? { "x-admin-secret": "test-admin" } : {}, body: request });
  const res = Object.assign(new EventEmitter(), { headers: {}, statusCode: 200, output: "", writableEnded: false,
    setHeader(k,v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.writableEnded = true; return this; },
    write(text) { this.output += text; return true; }, end() { this.writableEnded = true; } });
  return { req, res };
}
await test("HTTP guard blocks unauthenticated and disabled calls before upstream work", async () => {
  const handler = createChatHandler({ env, connect: () => { throw Error("must not connect"); } });
  const denied = exchange("POST", false); await handler(denied.req, denied.res); assert.equal(denied.res.statusCode, 401);
  const disabled = exchange(); await createChatHandler({ env: {} })(disabled.req, disabled.res); assert.equal(disabled.res.statusCode, 503);
});
function createWorkHarness(options) {
  return async (req, res) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    await createChatWork(options)({ request: req.body, requestId: 'test-turn' }, {
      signal: controller.signal,
      emit: async (event, data) => { res.output += 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'; },
    });
  };
}
await test("Worker streams text and route, hides raw tool data, and releases resources", async () => {
  let closed = 0, released = 0;
  const handler = createWorkHarness({ env, connect: async () => ({ sources: new Map(), close: async () => { closed++; } }),
    select: async () => ({ model: "gpt-5.6-sol", provider: "openai", source: "manual" }),
    admit: async () => async () => { released++; }, makeAgent: () => ({ stream: async () => ({ stream: (async function* () {
      yield { type: "tool-result", output: "PRIVATE RAW RESULT" }; yield { type: "text-delta", text: "Hello" };
      yield { type: "finish", finishReason: "stop" };
    })() }) }) });
  const { req,res } = exchange(); await handler(req,res);
  assert.match(res.output, /event: route/); assert.match(res.output, /Hello/); assert.match(res.output, /event: done/);
  assert.ok(!res.output.includes("PRIVATE RAW RESULT")); assert.equal(closed,1); assert.equal(released,1);
});
await test("routing is recorded once before generation and stays out of the browser stream", async () => {
  const decisions = [], events = [];
  const route = { model: 'gpt-5.6-sol', provider: 'openai', source: 'jev', jevChoice: 'claude-sonnet-5', fallbackUsed: true, confidence: 0.4, probability: 0.4 };
  const work = createChatWork({ env, admit: async () => async () => {}, connect: async () => ({ sources: new Map(), close: async () => {} }),
    select: async () => route, makeAgent: () => {
      assert.deepEqual(decisions, [route]);
      return { stream: async () => ({ stream: (async function* () { yield { type: 'text-delta', text: 'Answer' }; yield { type: 'finish', finishReason: 'stop' }; })() }) };
    } });
  const output = await work({ request, requestId: 'routing-test' }, { onRoute: decision => decisions.push(decision), emit: async (event, data) => events.push({event,data}) });
  assert.equal(output.status, 'complete'); assert.equal(decisions.length, 1);
  assert.deepEqual(events.find(e => e.event === 'route').data, { requestId: 'routing-test' });
  assert.ok(!JSON.stringify(events).includes('jevChoice'));
});
await test("midstream provider failures produce a safe error and cleanup", async () => {
  let closed = false;
  const handler = createWorkHarness({ env, connect: async () => ({ sources: new Map(), close: async () => { closed = true; } }),
    select: async () => ({ model: "gpt-5.6-sol", provider: "openai" }), admit: async () => async () => {},
    makeAgent: () => ({ stream: async () => ({ stream: (async function* () { yield { type: "error", error: new Error("SECRET") }; })() }) }) });
  const {req,res} = exchange(); await handler(req,res);
  assert.match(res.output, /"status":"failed"/); assert.ok(!res.output.includes("SECRET")); assert.ok(closed);
});
await test("Insights saves completed responses before done and reports storage failures safely", async () => {
  for (const fail of [false, true]) {
    let saved;
    const handler = createWorkHarness({ env: { ...env, ADMIN_CHAT_INSIGHTS_ENABLED: "1", SANITY_CONTEXT_WRITE_TOKEN: "fake" },
      connect: async () => ({ sources: new Map(), close: async () => {} }),
      select: async () => ({ model: "gpt-5.6-sol", provider: "openai" }), admit: async () => async () => {},
      saveTurn: async value => { saved = value; if (fail) throw Error("SECRET"); },
      makeAgent: () => ({ stream: async () => ({ stream: (async function* () {
        yield { type: "text-delta", text: "Answer" }; yield { type: "finish", finishReason: "stop" };
      })() }) }) });
    const {req,res} = exchange(); await handler(req,res);
    assert.equal(saved.text, "Answer"); assert.equal(saved.outcome, "complete");
    assert.ok(res.output.indexOf("event: snapshot") < res.output.indexOf("event: done"));
    assert.ok(res.output.includes(fail ? '"storage":"failed"' : '"storage":"saved"'));
    assert.ok(!res.output.includes("SECRET"));
  }
});
await test("concurrent request limit releases admission slots", async () => {
  const release1 = await admitChat("one"), release2 = await admitChat("two");
  await assert.rejects(admitChat("three"), /busy/);
  await release1(); const release3 = await admitChat("three"); await release2(); await release3();
});
await test("explicit task cancellation aborts generation and releases its connection and lease", async () => {
  let closed = false, released = false, observedSignal;
  const {req,res} = exchange();
  const handler = createWorkHarness({ env, connect: async () => ({ sources: new Map(), close: async () => { closed = true; } }),
    select: async () => ({ model: "gpt-5.6-sol", provider: "openai" }), admit: async () => async () => { released = true; },
    makeAgent: () => ({ stream: async ({abortSignal}) => { observedSignal = abortSignal; return { stream: (async function* () {
      res.destroyed = true; res.emit("close"); abortSignal.throwIfAborted();
    })() }; } }) });
  await handler(req,res);
  assert.ok(observedSignal.aborted); assert.ok(closed); assert.ok(released);
  assert.ok(!res.output.includes("event: error"));
});
await test("Context rejects oversized tool output and enforces its query budget", async () => {
  let calls = 0;
  const connection = await connectContext({ env, fetchImpl: async () => new Response("schema"), createClient: async () => ({
    close: async () => {}, tools: async () => ({ groq_query: { execute: async () => { calls++; return { content: [{ type: "text", text: "x".repeat(100001) }] }; } } })
  }) });
  for (let i = 0; i < 10; i++) await assert.rejects(connection.tools.groq_query.execute({ query: "count(*)" }), /too large/);
  await assert.rejects(connection.tools.groq_query.execute({ query: "count(*)" }), /budget exhausted/);
  assert.equal(calls, 10); await connection.close();
});
await test("real SDK agent completes a tool round trip before its final streamed answer", async () => {
  let calls = 0, tools = 0, records = 0;
  const usage = { inputTokens: { total: 5, noCache: 5 }, outputTokens: { total: 3, text: 3 } };
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: "stream-start", warnings: [] });
    if (++calls === 1) controller.enqueue({ type: "tool-call", toolCallId: "q1", toolName: "groq_query", input: '{}' });
    else { controller.enqueue({ type: "text-start", id: "t" }); controller.enqueue({ type: "text-delta", id: "t", delta: "Grounded answer" }); controller.enqueue({ type: "text-end", id: "t" }); }
    controller.enqueue({ type: "finish", finishReason: { unified: calls === 1 ? "tool-calls" : "stop", raw: "stop" }, usage }); controller.close();
  } }) }) });
  const { tool, jsonSchema } = await import("ai");
  const agent = createChatAgent({ route: { model: "gpt-5.6-sol", provider: "openai" }, ref: "test", makeModel: () => model, record: async () => { records++; },
    context: { initialContext: "schema", tools: { groq_query: tool({ inputSchema: jsonSchema({ type: "object", properties: {} }), execute: async () => { tools++; return "Evidence"; } }) } } });
  const result = await agent.stream({ messages: request.messages });
  let text = ""; for await (const part of result.stream) { if (part.type === "error") throw part.error; if (part.type === "text-delta") text += part.text; }
  assert.equal(text, "Grounded answer"); assert.equal(calls, 2); assert.equal(tools,1); assert.equal(records,2);
});
console.log(`passed ${passed}, failed ${failed}`);
process.exitCode = failed ? 1 : 0;
