import { createMCPClient } from "@ai-sdk/mcp";
import { CHAT_FILTER, CHAT_TYPES, chatError } from "./policy.js";

export function contextUrl(env = process.env) {
  let url;
  try { url = new URL(env.SANITY_CONTEXT_MCP_URL); } catch { throw chatError("Sanity Context is not configured.", 503, "CHAT_CONTEXT_UNAVAILABLE"); }
  if (url.origin !== "https://api.sanity.io" || url.username || url.password || url.hash ||
      !/^\/v1\/context\/organizations\/[a-zA-Z0-9_-]+\/mcp\/[a-z0-9-]+\/?$/.test(url.pathname))
    throw chatError("Sanity Context needs an organization MCP endpoint.", 503, "CHAT_CONTEXT_UNAVAILABLE");
  const configured = url.searchParams.get("groqFilter");
  url.searchParams.set("groqFilter", configured ? `(${configured}) && (${CHAT_FILTER})` : CHAT_FILTER);
  url.searchParams.set("perspective", "published");
  url.searchParams.set("mode", "groq");
  url.searchParams.set("tools", "initial_context,groq_query,schema_explorer");
  return url;
}

export function collectSources(result, sources) {
  function visit(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 20 || sources.size >= 40) return;
    if (!Array.isArray(value) && CHAT_TYPES.includes(value._type) && typeof value._id === "string") {
      const title = value.title || value.role || value.name || value.question || value._type;
      sources.set(value._id, { id: value._id, type: value._type, title: String(title).slice(0,200),
        ...(typeof value._rev === "string" ? { revision: value._rev } : {}),
        ...(value._type === "job" && typeof value.legacyId === "string" ? { jobId: value.legacyId } : {}) });
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  }
  visit(result.structuredContent);
  for (const part of result.content || []) {
    if (part.type === "text") { try { visit(JSON.parse(part.text)); } catch { /* Non-JSON results have no validated sources. */ } }
  }
}

export function validateContextToolInput(name, input) {
  if (name !== "groq_query") return;
  if (typeof input?.query !== "string" || input.query.length > 12000)
    throw new Error("Use a GROQ query under 12,000 characters.");
  // Live regression on 2026-09-24: Context appended an unparenthesized caller
  // OR after its scope filter. Until Sanity fixes that behavior, reject OR
  // conservatively (including quoted occurrences); use `in` or separate queries.
  if (input.query.includes("||")) throw new Error("OR queries are disabled for content access safety. Use an in expression or separate queries.");
}

export async function connectContext({ signal, env = process.env, fetchImpl = fetch, createClient = createMCPClient } = {}) {
  const url = contextUrl(env);
  if (!env.SANITY_ORGANIZATION_TOKEN?.trim()) throw chatError("Sanity Context requires an organization token.", 503, "CHAT_CONTEXT_UNAVAILABLE");
  const headers = { Authorization: `Bearer ${env.SANITY_ORGANIZATION_TOKEN.trim()}` };
  const boundedFetch = (input, init = {}) => fetchImpl(input, { ...init, redirect: "error",
    signal: AbortSignal.any([signal, init.signal, AbortSignal.timeout(20000)].filter(Boolean)) });
  let client;
  try {
    const initialUrl = new URL(url);
    initialUrl.pathname = initialUrl.pathname.replace(/\/$/, "") + "/initial-context";
    const response = await boundedFetch(initialUrl, { headers });
    if (!response.ok) throw new Error("Context unavailable");
    const initialContext = await response.text();
    if (!initialContext.trim() || initialContext.length > 100000) throw new Error("Invalid initial context");
    client = await createClient({ transport: { type: "http", url: url.toString(), headers, fetch: boundedFetch } });
    const discovered = await client.tools();
    if (!discovered.groq_query?.execute) throw new Error("Missing GROQ tool");
    const sources = new Map();
    let calls = 0;
    const tools = Object.fromEntries(["groq_query", "schema_explorer"].filter(name => discovered[name]?.execute).map(name => {
      const original = discovered[name];
      return [name, { ...original, execute: async (input, options) => {
        validateContextToolInput(name, input);
        if (++calls > 10) throw new Error("Content query budget exhausted. Answer using evidence already retrieved.");
        let result;
        try { result = await original.execute(input, options); }
        catch { throw new Error("Content query failed. Revise the query or explain the missing evidence."); }
        if (result.isError) throw new Error("Content query failed. Revise the query or explain the missing evidence.");
        if (JSON.stringify(result).length > 100000) throw new Error("Content result too large. Use a smaller projection or page.");
        collectSources(result, sources);
        return result;
      } }];
    }));
    return { initialContext, tools, sources, close: () => client.close() };
  } catch {
    await client?.close().catch(() => {});
    throw chatError("Sanity Context is unavailable. Check its endpoint, organization token and deployed schema.", 503, "CHAT_CONTEXT_UNAVAILABLE");
  }
}
