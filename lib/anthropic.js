// The single place every generator calls the Anthropic API from.
//
// Three generators used to each hand-roll the same fetch, which is how the fit
// analysis ended up with a weaker JSON parser than the cover letter's and why
// none of them cached anything. This is where that stops: one call site for
// the request shape, the refusal check, the usage record, and — the reason it
// exists now rather than later — the pause_turn replay and the server-tool
// error shape that a web-search-using task needs and none of today's three
// generators have ever had to handle.
//
// No SDK. Every caller already used raw fetch, and adding the SDK here would
// mean bundling it into a second runtime for no benefit this app needs.

import { resolveModel, refusalError, modelProvider } from "./models.js";
import { recordUsage } from "./usage.js";
import { generationEffort } from "./generation-context.js";
import { traceModelRequest } from "./ai-telemetry.js";

const ENDPOINT = "https://api.anthropic.com/v1/messages";

export function systemBlocksFor(system) {
  const cache = { type: "ephemeral", ...(process.env.AI_CACHE_TTL === "1h" ? { ttl: "1h" } : {}) };
  // shared is an exact prefix of stable, so splitting adds no duplicate context.
  const shared = system.shared && system.stable.startsWith(system.shared) ? system.shared : "";
  const stable = shared ? system.stable.slice(shared.length) : system.stable;
  return [
    ...(shared ? [{ type: "text", text: shared, cache_control: cache }] : []),
    ...(stable ? [{ type: "text", text: stable, cache_control: cache }] : []),
    ...(system.context ? [{ type: "text", text: system.context, cache_control: cache }] : []),
    ...(system.volatile ? [{ type: "text", text: system.volatile }] : []),
  ];
}

function textOf(blocks) {
  return (blocks || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

// web_search_tool_result carries a LIST of results on success and an OBJECT
// with an error_code on failure — both on a 200. Indexing before checking
// which one you got is the standard way this breaks.
export function toolResultErrors(blocks) {
  const errors = [];
  for (const b of blocks || []) {
    if (b.type !== "web_search_tool_result") continue;
    if (!Array.isArray(b.content)) errors.push((b.content && b.content.error_code) || "unknown");
  }
  return errors;
}

function addUsage(a, b) {
  if (!b) return a;
  const sw = (u) => (u && u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
  return {
    input_tokens: (a.input_tokens || 0) + (b.input_tokens || 0),
    output_tokens: (a.output_tokens || 0) + (b.output_tokens || 0),
    cache_read_input_tokens: (a.cache_read_input_tokens || 0) + (b.cache_read_input_tokens || 0),
    cache_creation_input_tokens: (a.cache_creation_input_tokens || 0) + (b.cache_creation_input_tokens || 0),
    server_tool_use: { web_search_requests: sw(a) + sw(b) },
  };
}

// system is { stable, volatile? }. stable carries the cache breakpoint, so it
// must be byte-identical across calls that should share a cache entry —
// nothing job-specific belongs in it. volatile is sent alongside, uncached.
//
// messages is a single user turn: [{ role: "user", content }]. Every caller in
// this codebase only ever needs one — the pause_turn replay below depends on
// that being true, since it resends messages[0] verbatim as the resume point.
export async function complete({
  model,
  effort,
  maxTokens = 16384,
  tools,
  system,
  messages,
  kind,
  ref,
  maxContinuations = 5,
  maxSearches,
  generationAttempt = 1,
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("Server is missing ANTHROPIC_API_KEY."), { status: 500, abort: true });
  }

  const resolvedModel = resolveModel(model);
  if (modelProvider(resolvedModel) !== "anthropic") {
    throw Object.assign(new Error("Use the shared AI client for OpenAI models."), { status: 500, abort: true });
  }
  const systemBlocks = systemBlocksFor(system);
  const effectiveEffort = effort || generationEffort(kind);

  let turnMessages = messages;
  let blocks = [];
  let usage = {};
  let data = null;

  for (let turn = 0; turn <= maxContinuations; turn++) {
    const started = Date.now();
    const remainingSearches = maxSearches == null ? null : Math.max(0, maxSearches - (usage.server_tool_use?.web_search_requests || 0));
    const turnTools = remainingSearches == null ? tools : tools?.map(tool => tool.name === "web_search"
      ? { ...tool, max_uses: Math.min(tool.max_uses ?? remainingSearches, remainingSearches) } : tool);
    const { response, data: responseData } = await traceModelRequest({ provider: "anthropic",
      model: resolvedModel, kind, attempt: generationAttempt, continuation: turn, maxTokens }, () => fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: resolvedModel,
        max_tokens: maxTokens,
        // Both supported models use adaptive thinking by default.
        output_config: { effort: effectiveEffort },
        ...(turnTools ? { tools: turnTools } : {}),
        system: systemBlocks,
        messages: turnMessages,
      }),
    }));

    if (!response.ok) {
      const text = await response.text();
      const providerStatus = response.status;
      await recordUsage({ kind, ref, model: resolvedModel, effort: effectiveEffort,
        ms: Date.now() - started, httpStatus: providerStatus, continuation: turn, generationAttempt });
      const permanent = providerStatus >= 400 && providerStatus < 500 && ![408, 409, 429].includes(providerStatus);
      throw Object.assign(new Error("Model service error"), {
        status: 502, providerStatus, detail: text.slice(0, 500), ...(permanent ? { abort: true } : {}),
      });
    }

    data = responseData;
    await recordUsage({ kind, ref, model: resolvedModel, effort: effectiveEffort, usage: data.usage,
      ms: Date.now() - started, httpStatus: response.status || 200, stopReason: data.stop_reason,
      continuation: turn, generationAttempt, cacheTtl: process.env.AI_CACHE_TTL === "1h" ? "1h" : "5m" });
    usage = addUsage(usage, data.usage);

    const refused = refusalError(data);
    if (refused) {
      // Retrying a refusal against the same prompt only spends more tokens on
      // the same answer. Marked so a caller that retries on failure (Trigger's
      // default 3 attempts, once this runs there) can tell the two apart.
      refused.abort = true;
      throw refused;
    }

    if (data.stop_reason === "max_tokens") {
      throw Object.assign(new Error("The model reached its output limit. Try a shorter request or a lower effort setting."),
        { status: 502, abort: true, code: "OUTPUT_LIMIT" });
    }

    blocks = blocks.concat(data.content || []);

    if (data.stop_reason !== "pause_turn") {
      return { blocks, text: textOf(data.content), stopReason: data.stop_reason, usage };
    }

    if (maxSearches != null && (usage.server_tool_use?.web_search_requests || 0) >= maxSearches) {
      throw Object.assign(new Error("Company research reached its search budget. Narrow the request before trying again."),
        { status: 502, abort: true, code: "SEARCH_LIMIT" });
    }

    // The server-side search loop stopped at its iteration limit and handed
    // back what it has so far. Resuming means replaying the original question
    // plus everything the assistant said, and nothing else — an extra
    // "Continue." message changes what was asked, and the model answers that
    // instead. blocks already accumulated this turn's content, which matters
    // for a caller reading search results: turn three's content does not
    // carry turn one's.
    turnMessages = [messages[0], { role: "assistant", content: data.content }];
  }

  console.error("Model call hit the continuation cap" + (kind ? " (" + kind + ")" : "") + ".");
  return { blocks, text: textOf(data.content), stopReason: data.stop_reason, usage, truncatedByCap: true };
}
