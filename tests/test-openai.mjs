import assert from "node:assert/strict";
import { complete } from "../lib/ai.js";
import { runAnalysis } from "../lib/analyze.js";
import { runCoverLetter } from "../lib/cover.js";
import { runAnswer } from "../lib/answer.js";
import { runBrief } from "../lib/brief.js";
import { readUsage } from "../lib/usage.js";
import { saveReport, findReportByHash } from "../lib/store.js";
import { toolResultErrors } from "../lib/anthropic.js";
process.env.OPENAI_API_KEY = "fake-openai";
process.env.ANTHROPIC_API_KEY = "fake-anthropic";
let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("ok " + name); }
  catch (error) { fail++; console.log("FAIL " + name + ": " + error.stack); }
}
let calls = [], status = 200, payload;
function mock(text = "Hello") {
  calls = []; status = 200;
  payload = { status: "completed", output: [
    { type: "reasoning", summary: [] },
    { type: "message", content: [{ type: "output_text", text, annotations: [] }] },
  ], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 400, cache_write_tokens: 100 },
    output_tokens: 300, output_tokens_details: { reasoning_tokens: 200 } } };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return { ok: status < 400, status, json: async () => payload, text: async () => "provider failure" };
  };
}
const request = { system: { shared: "RULES", stable: "RULES profile", context: "role", volatile: "steering" },
  messages: [{ role: "user", content: "Write" }], kind: "answer", ref: "openai-cost" };
await test("default Sol routes to Responses and preserves the complete prompt once", async () => {
  mock(); payload.output.unshift({ type: "message", phase: "commentary", content: [{ type: "output_text", text: "Working on it" }] }); const result = await complete(request); const call = calls[0];
  assert.equal(call.url, "https://api.openai.com/v1/responses");
  assert.equal(call.body.model, "gpt-5.6-sol"); assert.equal(call.headers.Authorization, "Bearer fake-openai");
  assert.equal(call.body.instructions, "RULES profile\n\nrole\n\nsteering");
  assert.deepEqual(call.body.input, request.messages); assert.equal(call.body.store, false);
  assert.equal(call.body.reasoning.effort, "high"); assert.equal(call.body.tools, undefined);
  assert.equal(result.text, "Hello");
  const [entry] = await readUsage(request.ref);
  assert.equal(entry.input, 500); assert.equal(entry.cacheRead, 400); assert.equal(entry.cacheWrite, 100);
  assert.equal(entry.output, 300); assert.equal(entry.estimatedCostMicros, 8660);
});
await test("Astra selection, effort and costs", async () => {
  mock(); await complete({ ...request, model: "gpt-6-astra", effort: "medium", maxTokens: 1234 });
  assert.equal(calls[0].body.model, "gpt-6-astra"); assert.equal(calls[0].body.max_output_tokens, 1234);
  assert.equal(calls[0].body.reasoning.effort, "medium");
  assert.equal((await readUsage(request.ref))[0].estimatedCostMicros, 21650);
});
await test("Claude remains on its provider", async () => {
  mock(); payload = { content: [{ type: "text", text: "Claude" }], stop_reason: "end_turn" };
  assert.equal((await complete({ ...request, model: "claude-opus-5" })).text, "Claude");
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
});
await test("OpenAI key absence fails before fetching, without switching providers", async () => {
  mock(); delete process.env.OPENAI_API_KEY;
  await assert.rejects(complete(request), e => e.abort && /OPENAI_API_KEY/.test(e.message));
  assert.equal(calls.length, 0); process.env.OPENAI_API_KEY = "fake-openai";
});
for (const code of [401, 429, 500]) await test("HTTP " + code + " retry policy and no fallback", async () => {
  mock(); status = code;
  await assert.rejects(complete(request), e => e.providerStatus === code && !!e.abort === (code === 401));
  assert.equal(calls.length, 1);
});
await test("refusal and output exhaustion abort instead of saving partial text", async () => {
  mock(); payload.output[1].content = [{ type: "refusal", refusal: "No" }];
  await assert.rejects(complete(request), e => e.abort && /declined/.test(e.message));
  mock(); payload.status = "incomplete"; payload.incomplete_details = { reason: "max_output_tokens" };
  await assert.rejects(complete(request), e => e.abort && e.code === "OUTPUT_LIMIT");
});
await test("failed and empty responses cannot become successful drafts", async () => {
  mock(); payload.status = "failed";
  await assert.rejects(complete(request), /did not complete/);
  mock(""); await assert.rejects(complete(request), /no text/);
});
await test("search caps, citations, sources and search errors use the shared contract", async () => {
  mock(); payload.output[1].content[0].annotations = [{ type: "url_citation", title: "Source", url: "https://example.com" }];
  payload.output.push({ type: "web_search_call", status: "completed", action: { sources: [{ title: "Source", url: "https://example.com" }] } });
  payload.output.push({ type: "web_search_call", status: "failed" });
  const result = await complete({ ...request, tools: [{ name: "web_search" }], maxSearches: 3 });
  assert.equal(calls[0].body.max_tool_calls, 3);
  assert.equal(result.blocks[0].citations[0].url, "https://example.com");
  assert.equal(result.blocks[1].content[0].title, "Source");
  assert.deepEqual(toolResultErrors(result.blocks), ["failed"]);
  assert.equal((await readUsage(request.ref))[0].searches, 2);
});
await test("Sol analysis parses JSON and keeps private scoring separate", async () => {
  mock(JSON.stringify({ job_title: "Engineer", company: "Sanity", pitch: "Fit", categories: [], differentiators: [], closing: "End", internal: { score: 70 } }));
  const out = await runAnalysis("A sufficiently long job description.");
  assert.equal(out.report.company, "Sanity"); assert.equal(out.internal.score, 70);
  assert.equal(out.report.internal, undefined);
});
await test("Astra cover letter, Sol answers and brief use their existing parsers", async () => {
  mock(JSON.stringify({ salutation: "Dear team,", paragraphs: [{ lead: true, text: "I have built this kind of platform before." }] }));
  const letter = await runCoverLetter({ model: "gpt-6-astra", report: { job_description: "Engineer" }, fitUrl: "https://example.com" });
  assert.ok(letter.paragraphs.length); assert.equal(calls[0].body.model, "gpt-6-astra");
  mock("I led the platform team."); const answer = await runAnswer({ question: "Describe your leadership?" });
  assert.equal(calls[0].body.model, "gpt-5.6-sol"); assert.equal(answer.answer, "I led the platform team.");
  mock(JSON.stringify({ opening: "Hello", questionsToAsk: [{ text: "What matters?" }] }));
  const brief = await runBrief({ job: { company: "Sanity", role: "Engineer" }, report: {}, research: { sources: [] } });
  assert.equal(brief.model, "gpt-5.6-sol"); assert.equal(brief.opening, "Hello");
});
await test("unlabelled historical reports never satisfy Sol's cache", async () => {
  const jd = "Legacy report description for cache isolation.";
  await saveReport({ company: "Legacy", job_description: jd });
  const old = await findReportByHash(jd, { model: "claude-opus-5" });
  assert.ok(old); assert.equal(await findReportByHash(jd, { model: "gpt-5.6-sol" }), null);
});
console.log(`passed ${pass}, failed ${fail}`);
process.exit(fail ? 1 : 0);
