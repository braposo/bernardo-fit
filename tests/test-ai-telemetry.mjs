import assert from "node:assert/strict";
import { logger } from "@trigger.dev/sdk";
import { traceModelRequest } from "../lib/ai-telemetry.js";

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
      attempt: 1, continuation: 0, maxTokens: 128 }, async () => ({ ok: false, status: 429 }));
    const attributes = spans.at(-1).attributes;
    assert.equal(attributes["gen_ai.response.model"], "claude-opus-5");
    assert.equal(attributes["http.response.status_code"], 429);
    assert.equal(attributes["gen_ai.response.finish_reasons"], '["error"]');
  });
} finally {
  logger.trace = originalTrace;
}

console.log(`passed ${pass}, failed ${fail}`);
process.exitCode = fail ? 1 : 0;
