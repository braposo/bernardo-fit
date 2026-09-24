import { recordUsage } from "./usage.js";
import { generationEffort } from "./generation-context.js";
import { traceModelRequest } from "./ai-telemetry.js";

const failure = (message, extra = {}) => Object.assign(new Error(message), { status: 502, ...extra });

export async function complete({ model, effort, maxTokens = 16384, tools, system, messages,
  kind, ref, maxSearches = 8, generationAttempt = 1 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw failure("Server is missing OPENAI_API_KEY.", { status: 500, abort: true });
  const effectiveEffort = effort || generationEffort(kind);
  if (tools?.some(tool => tool.name !== "web_search")) throw failure("Unsupported OpenAI tool.", { abort: true });
  const search = !!tools?.length;
  if (search && maxSearches < 1) throw failure("Company research reached its search budget.", { abort: true, code: "SEARCH_LIMIT" });
  const started = Date.now();
  const { response, data } = await traceModelRequest({ provider: "openai", model, kind,
    attempt: generationAttempt, maxTokens }, () => fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, store: false, reasoning: { effort: effectiveEffort }, max_output_tokens: maxTokens,
      // shared is already a prefix of stable; do not repeat it.
      instructions: [system.stable, system.context, system.volatile].filter(Boolean).join("\n\n"),
      input: messages,
      ...(search ? { tools: [{ type: "web_search" }], max_tool_calls: maxSearches,
        include: ["web_search_call.action.sources"] } : {}),
    }),
  }));
  if (!response.ok) {
    await recordUsage({ kind, ref, model, effort: effectiveEffort, ms: Date.now() - started,
      httpStatus: response.status, generationAttempt });
    const permanent = response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status);
    throw failure("Model service error", { providerStatus: response.status, ...(permanent ? { abort: true } : {}) });
  }
  const output = Array.isArray(data.output) ? data.output : [];
  const content = output.filter(item => item.type === "message" && item.phase !== "commentary").flatMap(item => item.content || []);
  const refused = content.some(item => item.type === "refusal");
  const limited = data.incomplete_details?.reason === "max_output_tokens";
  const stopReason = refused ? "refusal" : limited ? "max_tokens" : data.status === "completed" ? "end_turn" : data.status || "invalid_response";
  const searches = output.filter(item => item.type === "web_search_call");
  const cached = data.usage?.input_tokens_details?.cached_tokens || 0;
  const written = data.usage?.input_tokens_details?.cache_write_tokens || 0;
  const usage = data.usage ? {
    input_tokens: Math.max(0, data.usage.input_tokens - cached - written),
    output_tokens: data.usage.output_tokens, // Includes reasoning tokens already.
    cache_read_input_tokens: cached, cache_creation_input_tokens: written,
    // OpenAI reports cache writes without Anthropic's 5m/1h categories.
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
    server_tool_use: { web_search_requests: searches.length },
  } : undefined;
  await recordUsage({ kind, ref, model, effort: effectiveEffort, usage,
    ms: Date.now() - started, generationAttempt, stopReason,
    httpStatus: data.status === "completed" ? 200 : 502 });
  if (refused) throw failure("The model declined to write this.", { abort: true });
  if (limited) throw failure("The model reached its output limit. Try a shorter request or a lower effort setting.", { abort: true, code: "OUTPUT_LIMIT" });
  if (data.status !== "completed" || data.error) throw failure("The model did not complete this response.", {
    ...(data.status === "incomplete" ? { abort: true } : {}),
  });
  const blocks = content.filter(item => item.type === "output_text").map(item => ({
    type: "text", text: item.text,
    citations: (item.annotations || []).filter(a => a.type === "url_citation").map(a => ({ title: a.title, url: a.url })),
  }));
  for (const call of searches) blocks.push({ type: "web_search_tool_result",
    content: call.status === "completed" ? call.action?.sources || [] : { error_code: call.status || "unknown" } });
  const text = blocks.filter(b => b.type === "text").map(b => b.text).join("\n");
  if (!text.trim()) throw failure("The model returned no text.");
  return { blocks, text, stopReason, usage };
}
