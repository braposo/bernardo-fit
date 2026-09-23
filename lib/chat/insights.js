import { createClient } from "@sanity/client";
import { contextUrl } from "./context.js";
import { chatError } from "./policy.js";

export function insightsClient(env = process.env) {
  if (!env.SANITY_CONTEXT_WRITE_TOKEN?.trim())
    throw chatError("Conversation storage is not configured.", 503, "CHAT_INSIGHTS_UNAVAILABLE");
  const url = contextUrl(env);
  return createClient({ apiVersion: "v2025-11-27", token: env.SANITY_CONTEXT_WRITE_TOKEN.trim(),
    context: { organizationId: url.pathname.split("/")[4] }, useCdn: false, useProjectHostname: false,
    maxRetries: 0, timeout: 10000 });
}

// Immutable turn snapshots prevent a late/aborted request overwriting a newer
// conversation. The conversation ID groups them; request ID makes retries safe.
export async function saveChatTurn({ request, ref, route, text, outcome, env = process.env,
  client = insightsClient(env) }) {
  const endpoint = contextUrl(env).pathname.split("/").filter(Boolean).at(-1);
  await client.context.conversations.save({
    threadId: `admin-chat.${ref}`,
    messages: [...request.messages, ...(text ? [{ role: "assistant", content: text }] : [])],
    modelProvider: route?.provider, modelId: route?.model,
    metadata: { mcpEndpoints: [endpoint], conversationId: request.conversationId || ref,
      outcome, environment: env.VERCEL_ENV || "development", policy: route?.policy || "unknown" },
    sharing: { metrics: false, conversations: false },
  }, { signal: AbortSignal.timeout(10000) });
}
