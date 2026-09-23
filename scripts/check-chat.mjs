// Read-only preflight. Never prints credentials, schema content, or private records.
import { connectContext } from "../lib/chat/context.js";
import { chatModels } from "../lib/chat/models.js";
import { jevEnabled } from "../lib/jev.js";
let context;
try {
  const models = chatModels();
  console.log(JSON.stringify({ providers: { openai: models.some(m => m.provider === "openai" && m.available),
    anthropic: models.some(m => m.provider === "anthropic" && m.available) }, jev: jevEnabled(),
    enabled: process.env.ADMIN_CHAT_ENABLED === "1" }));
  context = await connectContext({ signal: AbortSignal.timeout(30000) });
  await context.tools.groq_query.execute({ query: "count(*)" }, { toolCallId: "chat-preflight", messages: [], abortSignal: AbortSignal.timeout(15000) });
  console.log(JSON.stringify({ context: "connected", tools: Object.keys(context.tools), query: "passed" }));
  if (!models.some(m => m.provider === "openai" && m.available) || !models.some(m => m.provider === "anthropic" && m.available) || !jevEnabled()) {
    console.error("Context is ready; configure both provider keys and TYPESAFE_API_KEY to complete chat setup.");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.code?.startsWith("CHAT_") ? error.message : "Chat preflight failed. Check the scoped Context connection.");
  process.exitCode = 1;
} finally { await context?.close().catch(() => {}); }
