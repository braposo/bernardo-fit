import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { requireAdmin } from "../../lib/admin.js";
import { jevEnabled } from "../../lib/jev.js";
import { chatModels, selectChatModel } from "../../lib/chat/models.js";
import { connectContext } from "../../lib/chat/context.js";
import { createChatAgent } from "../../lib/chat/agent.js";
import { admitChat } from "../../lib/chat/admission.js";
import { validateChatRequest } from "../../lib/chat/policy.js";

// Native Node/Vercel SSE transport, independent of the eventual React renderer.
// Only safe status, text and source metadata cross this boundary; never raw tools.
export function createChatHandler({ connect = connectContext, select = selectChatModel,
  makeAgent = createChatAgent, admit = admitChat, env = process.env } = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "private, no-store");
    if (!requireAdmin(req, res)) return;
    if (req.method === "GET") return res.status(200).json({ models: chatModels(env), autoAvailable: jevEnabled(env),
      enabled: env.ADMIN_CHAT_ENABLED === "1", contextConfigured: !!env.SANITY_CONTEXT_MCP_URL && !!env.SANITY_ORGANIZATION_TOKEN });
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ error: "Method not allowed" }); }
    if (env.ADMIN_CHAT_ENABLED !== "1") return res.status(503).json({ error: "Chat is not enabled yet.", code: "CHAT_DISABLED" });
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(180000)]);
    const disconnect = () => { if (!res.writableEnded) abort.abort(); };
    res.on("close", disconnect);
    req.on("aborted", disconnect);
    let context, release, streaming = false;
    const send = async (event, data) => {
      signal.throwIfAborted();
      if (!res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) await once(res, "drain", { signal });
    };
    try {
      const request = validateChatRequest(req.body);
      const ref = randomUUID();
      release = await admit(ref);
      // Check Context before incurring a routing/model call.
      context = await connect({ signal, env });
      const route = await select(request, { env, ref, signal });
      signal.throwIfAborted();
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      streaming = true;
      await send("route", { requestId: ref, ...route });
      const result = await makeAgent({ route, context, ref }).stream({ messages: request.messages, abortSignal: signal });
      let finished = false;
      for await (const part of result.stream) {
        if (part.type === "error" || part.type === "abort") throw new Error("Generation interrupted");
        if (part.type === "text-delta") await send("text", { text: part.text });
        if (part.type === "tool-call") await send("activity", { state: "reading", tool: part.toolName });
        if (part.type === "tool-error") await send("activity", { state: "query-failed", tool: part.toolName });
        if (part.type === "tool-result") await send("sources", { sources: [...context.sources.values()] });
        if (part.type === "finish") {
          if (["error", "content-filter", "other", "tool-calls"].includes(part.finishReason)) throw new Error("No final answer");
          await send("done", { finishReason: part.finishReason, truncated: part.finishReason === "length" });
          finished = true;
        }
      }
      if (!finished) throw new Error("Incomplete stream");
    } catch (error) {
      if (!abort.signal.aborted && !res.destroyed) {
        const safe = typeof error.code === "string" && error.code.startsWith("CHAT_");
        const body = { error: safe ? error.message : signal.aborted ? "The response timed out. Try a shorter question." : "Chat could not complete the response. Please retry.",
          code: safe ? error.code : "CHAT_FAILED" };
        if (streaming) res.write(`event: error\ndata: ${JSON.stringify(body)}\n\n`);
        else res.status(safe ? error.status : 502).json(body);
      }
    } finally {
      await context?.close().catch(() => {});
      await release?.().catch(() => {});
      res.off("close", disconnect);
      req.off("aborted", disconnect);
      if (streaming && !res.writableEnded && !res.destroyed) res.end();
    }
  };
}

export default createChatHandler();
