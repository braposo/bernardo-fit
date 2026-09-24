import assert from "node:assert/strict";
import { logger } from "@trigger.dev/sdk";
import { traceModelRequest } from "../lib/ai-telemetry.js";
import { promptIdentity, promptTelemetryMetadata, chatPromptSpanAttributes } from "../lib/prompt-telemetry.js";
import { setModelContentAttributes } from "../lib/gen-ai-content.js";

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log("ok " + name); }
  catch (error) { fail++; console.log("FAIL " + name + ": " + error.stack); }
}

const originalTrace = logger.trace;
const spans = [];
logger.trace = async (name, fn) => {
  const attributes = {};
  spans.push({ name, attributes });
  return fn({ setAttribute: (key, value) => { attributes[key] = value; } });
};

try {
  await test("OpenAI total includes cached input and reasoning remains inside output", async () => {
    const { data } = await traceModelRequest({ provider: "openai", model: "gpt-5.6-sol",
      kind: "answer", attempt: 2, maxTokens: 512 }, async () => ({ ok: true, status: 200,
      json: async () => ({ model: "gpt-5.6-sol", status: "completed", usage: {
        input_tokens: 100, output_tokens: 20,
        input_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 },
        output_tokens_details: { reasoning_tokens: 8 },
      } }) }));
    assert.equal(data.usage.input_tokens, 100);
    const span = spans.at(-1);
    assert.equal(span.name, "chat gpt-5.6-sol");
    assert.equal(span.attributes["gen_ai.usage.input_tokens"], 100);
    assert.equal(span.attributes["gen_ai.usage.output_tokens"], 20);
    assert.equal(span.attributes["gen_ai.usage.cache_read.input_tokens"], 30);
    assert.equal(span.attributes["gen_ai.usage.cache_creation.input_tokens"], 10);
    assert.equal(span.attributes["fit.ai.attempt"], 2);
    assert.equal(span.attributes["http.response.status_code"], 200);
    assert.equal(span.attributes["gen_ai.response.finish_reasons"], '["stop"]');
    assert.equal(JSON.stringify(span.attributes).includes("prompt"), false);
  });

  await test("Anthropic totals uncached input with cache reads and writes per continuation", async () => {
    await traceModelRequest({ provider: "anthropic", model: "claude-sonnet-5",
      kind: "research", attempt: 1, continuation: 1, maxTokens: 128 }, async () => ({ ok: true, status: 200,
      json: async () => ({ model: "claude-sonnet-5", stop_reason: "pause_turn", usage: {
        input_tokens: 10, cache_read_input_tokens: 40, cache_creation_input_tokens: 5, output_tokens: 7,
      } }) }));
    const attributes = spans.at(-1).attributes;
    assert.equal(attributes["gen_ai.usage.input_tokens"], 55);
    assert.equal(attributes["gen_ai.usage.cache_read.input_tokens"], 40);
    assert.equal(attributes["gen_ai.usage.cache_creation.input_tokens"], 5);
    assert.equal(attributes["fit.ai.continuation"], 1);
    assert.equal(attributes["gen_ai.response.finish_reasons"], '["pause_turn"]');
  });

  await test("failed provider requests still have a model span and HTTP status", async () => {
    await traceModelRequest({ provider: "anthropic", model: "claude-opus-5",
      attempt: 1, continuation: 0, maxTokens: 128,
      requestBody: { system: [{ type: "text", text: "Private rubric" }],
        messages: [{ role: "user", content: "Private evidence" }] } },
    async () => ({ ok: false, status: 429 }));
    const attributes = spans.at(-1).attributes;
    assert.equal(attributes["gen_ai.response.model"], "claude-opus-5");
    assert.equal(attributes["http.response.status_code"], 429);
    assert.equal(attributes["gen_ai.response.finish_reasons"], '["error"]');
    assert.equal(JSON.parse(attributes["gen_ai.input.messages"])[0].parts[0].content, "Private evidence");
    assert.equal("gen_ai.output.messages" in attributes, false);
  });

  await test("OpenAI content records instructions, user input, search and response", async () => {
    await traceModelRequest({ provider: "openai", model: "gpt-5.6-sol", requestBody: {
      instructions: "Private instructions", input: [{ role: "user", content: "Private question" }],
      tools: [{ type: "web_search" }],
    } }, async () => ({ ok: true, status: 200, json: async () => ({ status: "completed",
      output: [{ type: "web_search_call", id: "call-1", action: { query: "Example" } },
        { type: "message", content: [{ type: "output_text", text: "Private answer" }] }],
    }) }));
    const attributes = spans.at(-1).attributes;
    assert.deepEqual(JSON.parse(attributes["gen_ai.system_instructions"]), [{ type: "text", content: "Private instructions" }]);
    assert.deepEqual(JSON.parse(attributes["gen_ai.input.messages"]),
      [{ role: "user", parts: [{ type: "text", content: "Private question" }] }]);
    assert.equal(JSON.parse(attributes["gen_ai.tool.definitions"])[0].type, "web_search");
    assert.equal(JSON.parse(attributes["gen_ai.output.messages"])[0].parts[1].content, "Private answer");
    assert.equal(JSON.stringify(attributes).includes("Bearer"), false);
  });

  await test("Anthropic content records cached system blocks and continuation tool results", async () => {
    const attributes = {};
    setModelContentAttributes((key, value) => { attributes[key] = value; }, { provider: "anthropic",
      request: { system: [{ type: "text", text: "Private rubric", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: "Private evidence" }] },
          { role: "assistant", content: [{ type: "tool_use", id: "search-1", input: { query: "role" } }] }],
        tools: [{ name: "web_search" }] },
      data: { content: [{ type: "text", text: "Private finding" },
        { type: "web_search_tool_result", tool_use_id: "search-1", content: [{ title: "Result" }] }] } });
    assert.equal(JSON.parse(attributes["gen_ai.system_instructions"])[0].content, "Private rubric");
    assert.equal(JSON.parse(attributes["gen_ai.input.messages"])[1].parts[0].type, "tool_call");
    assert.equal(JSON.parse(attributes["gen_ai.output.messages"])[0].parts[1].type, "tool_call_response");
  });

  await test("Jev content records exact assessment input and returned answers", async () => {
    const attributes = {};
    setModelContentAttributes((key, value) => { attributes[key] = value; }, { provider: "typesafe",
      request: { model: "jev-1.13.0", state: { messages: ["Private chat"] },
        questions: { route: { type: "noul", instructions: "Assess route" } } },
      data: { answers: { route: { type: "noul", noul: 0.9 } } } });
    const input = JSON.parse(JSON.parse(attributes["gen_ai.input.messages"])[0].parts[0].content);
    assert.deepEqual(input.state.messages, ["Private chat"]);
    assert.equal(input.questions.route.type, "noul");
    const answer = JSON.parse(JSON.parse(attributes["gen_ai.output.messages"])[0].parts[0].content);
    assert.equal(answer.route.noul, 0.9);
  });

  await test("prompt identity is stable for a rubric and changes with its published text", async () => {
    const first = promptIdentity("jev-fit", { score: "Fit criteria" }, "sanity-a");
    assert.deepEqual(promptIdentity("jev-fit", { score: "Fit criteria" }, "sanity-a"), first);
    assert.notEqual(promptIdentity("jev-fit", { score: "Revised criteria" }, "sanity-b").version, first.version);
    assert.equal(promptTelemetryMetadata(first)["prompt.version"], String(first.version));
    await traceModelRequest({ provider: "openai", model: "gpt-5.6-sol", kind: "answer",
      attempt: 1, maxTokens: 128, prompt: first }, async () => ({ ok: false, status: 429 }));
    const attributes = spans.at(-1).attributes;
    assert.equal(attributes["prompt.slug"], "fit-jev-fit");
    assert.equal(attributes["prompt.version"], first.version);
    assert.equal(attributes["fit.ai.prompt.fingerprint"], first.fingerprint);
    assert.equal(attributes["fit.ai.prompt.revision"], "sanity-a");
    assert.equal(attributes["ai.telemetry.metadata.prompt.slug"], "fit-jev-fit");
    assert.equal(attributes["ai.telemetry.metadata.prompt.version"], String(first.version));
    assert.equal(JSON.stringify(attributes).includes("Fit criteria"), false);
  });

  await test("AI SDK model spans receive the same indexed prompt attributes", async () => {
    const prompt = promptIdentity("admin-chat", ["assistant rules", "context rules"], "chat-rev");
    const attributes = chatPromptSpanAttributes({ spanType: "languageModel", runtimeContext: { promptTelemetry: prompt } });
    assert.equal(attributes["ai.telemetry.metadata.prompt.slug"], "fit-admin-chat");
    assert.equal(attributes["fit.ai.prompt.fingerprint"], prompt.fingerprint);
    assert.deepEqual(chatPromptSpanAttributes({ spanType: "operation", runtimeContext: { promptTelemetry: prompt } }), {});
    assert.equal(JSON.stringify(attributes).includes("assistant rules"), false);
  });
} finally {
  logger.trace = originalTrace;
}

console.log(`passed ${pass}, failed ${fail}`);
process.exitCode = fail ? 1 : 0;
