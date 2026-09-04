// Guards the shared Anthropic client itself — the one call site every
// generator now goes through, and the place the pause_turn replay and the
// server-tool error shape live for the day a generator actually declares
// tools. Nothing here touches the real API; every case mocks globalThis.fetch
// before importing the module under test, in the house style.

import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const lib = "file:///" + root + "lib/";

process.env.ANTHROPIC_API_KEY = "sk-fake";

let pass = 0, fail = 0;
const check = (n, c, e) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 300) : "")); }
};

function textReply(text, extra) {
  return { ok: true, json: async () => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, ...extra }) };
}

console.log("\n--- the system blocks ---");
{
  const calls = [];
  globalThis.fetch = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return textReply("hi"); };
  const { complete } = await import(lib + "anthropic.js");

  await complete({ model: "claude-opus-5", system: { stable: "RULES", volatile: "JOB SPECIFIC" }, messages: [{ role: "user", content: "go" }], kind: "test", ref: "r1" });
  const body = calls[0];
  check("system is an array of two blocks", Array.isArray(body.system) && body.system.length === 2, body.system);
  check("the first block carries the stable text", body.system[0].text === "RULES");
  check("only the first block carries cache_control", JSON.stringify(body.system[0].cache_control) === '{"type":"ephemeral"}' && body.system[1].cache_control === undefined, body.system);
  check("the second block carries the volatile text", body.system[1].text === "JOB SPECIFIC");

  calls.length = 0;
  await complete({ model: "claude-opus-5", system: { stable: "RULES" }, messages: [{ role: "user", content: "go" }], kind: "test" });
  check("an empty volatile is simply omitted, not sent as an empty block", calls[0].system.length === 1, calls[0].system);
}

console.log("\n--- never sends the removed thinking controls ---");
{
  const calls = [];
  globalThis.fetch = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return textReply("hi"); };
  const { complete } = await import(lib + "anthropic.js");
  await complete({ model: "claude-opus-5", system: { stable: "x" }, messages: [{ role: "user", content: "go" }], kind: "test" });
  check("no thinking field", !("thinking" in calls[0]), calls[0]);
  check("no budget_tokens anywhere in the body", !JSON.stringify(calls[0]).includes("budget_tokens"));
}

console.log("\n--- effort, when given, rides in output_config and nowhere else by default ---");
{
  const calls = [];
  globalThis.fetch = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return textReply("hi"); };
  const { complete } = await import(lib + "anthropic.js");
  await complete({ model: "claude-opus-5", effort: "medium", system: { stable: "x" }, messages: [{ role: "user", content: "go" }], kind: "test" });
  check("effort lands in output_config", calls[0].output_config && calls[0].output_config.effort === "medium", calls[0]);
  calls.length = 0;
  await complete({ model: "claude-opus-5", system: { stable: "x" }, messages: [{ role: "user", content: "go" }], kind: "test" });
  check("omitted entirely when not given", !("output_config" in calls[0]), calls[0]);
}

console.log("\n--- max_tokens defaults and can be overridden ---");
{
  const calls = [];
  globalThis.fetch = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return textReply("hi"); };
  const { complete } = await import(lib + "anthropic.js");
  await complete({ model: "claude-opus-5", system: { stable: "x" }, messages: [{ role: "user", content: "go" }], kind: "test" });
  check("default is 16384", calls[0].max_tokens === 16384);
  calls.length = 0;
  await complete({ model: "claude-opus-5", maxTokens: 4096, system: { stable: "x" }, messages: [{ role: "user", content: "go" }], kind: "test" });
  check("override is respected", calls[0].max_tokens === 4096);
}

console.log("\n--- tools, when given, are forwarded; when not, no key at all ---");
{
  const calls = [];
  globalThis.fetch = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return textReply("hi"); };
  const { complete } = await import(lib + "anthropic.js");
  const tools = [{ type: "web_search_20260318", name: "web_search", max_uses: 8 }];
  await complete({ model: "claude-opus-5", tools, system: { stable: "x" }, messages: [{ role: "user", content: "go" }], kind: "test" });
  check("tools forwarded verbatim", JSON.stringify(calls[0].tools) === JSON.stringify(tools));
  calls.length = 0;
  await complete({ model: "claude-opus-5", system: { stable: "x" }, messages: [{ role: "user", content: "go" }], kind: "test" });
  check("no tools key when none given", !("tools" in calls[0]), calls[0]);
}

console.log("\n--- a plain reply returns cleanly ---");
{
  globalThis.fetch = async () => textReply("the answer");
  const { complete } = await import(lib + "anthropic.js");
  const out = await complete({ model: "claude-opus-5", system: { stable: "x" }, messages: [{ role: "user", content: "go" }], kind: "test" });
  check("text extracted", out.text === "the answer");
  check("stop reason surfaced", out.stopReason === "end_turn");
  check("one block returned", out.blocks.length === 1 && out.blocks[0].text === "the answer");
  check("usage returned", out.usage.input_tokens === 10 && out.usage.output_tokens === 5, out.usage);
}

console.log("\n--- a refusal is thrown, not returned, and marked non-retryable ---");
{
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ stop_reason: "refusal", stop_details: { category: "frontier_llm", explanation: "no" }, usage: {} }),
  });
  const { complete } = await import(lib + "anthropic.js");
  let caught = null;
  try {
    await complete({ model: "claude-opus-5", system: { stable: "x" }, messages: [{ role: "user", content: "go" }], kind: "test" });
  } catch (err) { caught = err; }
  check("threw", !!caught, caught);
  check("carries a status", caught && caught.status === 502);
  check("marked abort so a caller does not retry it", caught && caught.abort === true);
}

console.log("\n--- a non-ok response throws with the detail ---");
{
  globalThis.fetch = async () => ({ ok: false, text: async () => "server exploded, details omitted" });
  const { complete } = await import(lib + "anthropic.js");
  let caught = null;
  try {
    await complete({ model: "claude-opus-5", system: { stable: "x" }, messages: [{ role: "user", content: "go" }], kind: "test" });
  } catch (err) { caught = err; }
  check("threw", !!caught);
  check("status 502", caught && caught.status === 502);
  check("detail carried", caught && caught.detail.includes("server exploded"));
}

console.log("\n--- pause_turn: the replay shape ---");
{
  // Turn one pauses with a search result; turn two finishes. Content defined
  // once so the assertions below compare against the exact same blocks the
  // mock handed back, not a re-derived copy.
  const turn1Content = [
    { type: "text", text: "searching" },
    { type: "server_tool_use", id: "t1", name: "web_search", input: { query: "x" } },
    { type: "web_search_tool_result", tool_use_id: "t1", content: [{ type: "web_search_result", url: "https://x.test", title: "X", encrypted_content: "ENC1" }] },
  ];
  const responses = [
    { ok: true, json: async () => ({ content: turn1Content, stop_reason: "pause_turn", usage: { input_tokens: 5, output_tokens: 2 } }) },
    { ok: true, json: async () => ({ content: [{ type: "text", text: "final answer" }], stop_reason: "end_turn", usage: { input_tokens: 8, output_tokens: 3 } }) },
  ];
  const calls = [];
  let n = 0;
  globalThis.fetch = async (_url, opts) => { calls.push(JSON.parse(opts.body)); return responses[n++]; };
  const { complete } = await import(lib + "anthropic.js");

  const original = [{ role: "user", content: "look this up" }];
  const out = await complete({ model: "claude-opus-5", tools: [{ type: "web_search_20260318", name: "web_search" }], system: { stable: "x" }, messages: original, kind: "research" });

  check("exactly two HTTP calls for a single pause", calls.length === 2, calls.length);
  check("the resume replays exactly the original user turn plus the assistant content", JSON.stringify(calls[1].messages[0]) === JSON.stringify(original[0]));
  check("and the assistant turn carries turn one's content verbatim", JSON.stringify(calls[1].messages[1].content) === JSON.stringify(turn1Content));
  check("no Continue. message anywhere in the resume request", JSON.stringify(calls[1]).includes("Continue.") === false);
  check("only two messages in the resume, not three", calls[1].messages.length === 2, calls[1].messages);
  check("the resumed assistant turn is role assistant", calls[1].messages[1].role === "assistant");
  check("the encrypted_content survives the replay byte for byte", JSON.stringify(calls[1].messages[1].content).includes("ENC1"));

  check("blocks accumulate across both turns", out.blocks.some((b) => b.type === "web_search_tool_result") && out.blocks.some((b) => b.text === "final answer"), out.blocks.map((b) => b.type));
  check("the returned text is the terminal turn's text, not turn one's preamble", out.text === "final answer");
  check("usage is summed across both turns", out.usage.input_tokens === 13 && out.usage.output_tokens === 5, out.usage);
}

console.log("\n--- pause_turn: the continuation cap ---");
{
  let n = 0;
  const paused = () => ({
    ok: true,
    json: async () => ({ content: [{ type: "text", text: "still going " + n }], stop_reason: "pause_turn", usage: { input_tokens: 1, output_tokens: 1 } }),
  });
  const calls = [];
  globalThis.fetch = async (_url, opts) => { calls.push(opts); n++; return paused(); };
  const { complete } = await import(lib + "anthropic.js");

  const out = await complete({ model: "claude-opus-5", tools: [{ type: "web_search_20260318", name: "web_search" }], system: { stable: "x" }, messages: [{ role: "user", content: "go" }], kind: "research" });
  check("stops at maxContinuations + 1 calls (default 5)", calls.length === 6, calls.length);
  check("reports it hit the cap", out.truncatedByCap === true);
  check("still returns whatever it accumulated rather than throwing", Array.isArray(out.blocks) && out.blocks.length === 6, out.blocks.length);
}

console.log("\n--- max_tokens hit is logged, not thrown ---");
{
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: "cut off" }], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 1 } }) });
  const { complete } = await import(lib + "anthropic.js");
  const out = await complete({ model: "claude-opus-5", system: { stable: "x" }, messages: [{ role: "user", content: "go" }], kind: "test" });
  check("still returns the partial text rather than throwing", out.text === "cut off");
  check("stop reason surfaced so the caller can act on it", out.stopReason === "max_tokens");
}

console.log("\n--- server-tool errors surface in the blocks, they do not throw ---");
{
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      content: [
        { type: "web_search_tool_result", tool_use_id: "t1", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
        { type: "text", text: "done anyway" },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  });
  const { complete, toolResultErrors } = await import(lib + "anthropic.js");
  const out = await complete({ model: "claude-opus-5", tools: [{ type: "web_search_20260318", name: "web_search" }], system: { stable: "x" }, messages: [{ role: "user", content: "go" }], kind: "research" });
  check("did not throw", out.text === "done anyway");
  check("toolResultErrors reads the object-shaped error", toolResultErrors(out.blocks).length === 1 && toolResultErrors(out.blocks)[0] === "max_uses_exceeded", toolResultErrors(out.blocks));
}
{
  const { toolResultErrors } = await import(lib + "anthropic.js");
  const listShaped = [{ type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://x" }] }];
  check("a successful (list-shaped) result reports no error", toolResultErrors(listShaped).length === 0);
  check("blocks with no error_code still record something rather than crashing", toolResultErrors([{ type: "web_search_tool_result", content: {} }])[0] === "unknown");
}

console.log("\n--- a missing API key fails before any network call ---");
{
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; return textReply("x"); };
  const { complete } = await import(lib + "anthropic.js");
  let caught = null;
  try {
    await complete({ model: "claude-opus-5", system: { stable: "x" }, messages: [{ role: "user", content: "go" }], kind: "test" });
  } catch (err) { caught = err; }
  check("threw before fetching", !!caught && !fetchCalled);
  check("status 500", caught && caught.status === 500);
  process.env.ANTHROPIC_API_KEY = key;
}

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
