export const CHAT_TYPES = ["candidateProfile", "candidateEvidence", "job", "applicationQuestion",
  "fitAssessment", "fitReport", "coverLetter", "companyResearch", "interviewBrief", "sitePage", "writingGuidance"];
export const CHAT_FILTER = `_type in ${JSON.stringify(CHAT_TYPES)} && !defined(deletedAt) && pending != true && !(_id in path("drafts.**")) && !(_id in path("versions.**"))`;
export function chatError(message, status = 400, code = "CHAT_INVALID_REQUEST") {
  return Object.assign(new Error(message), { status, code });
}

// Accept text-only conversation history. Clients cannot supply system/tool messages,
// endpoint URLs, credentials, provider options or arbitrary tool results.
export function validateChatRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw chatError("A chat request is required.");
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 40)
    throw chatError("Send between 1 and 40 messages.");
  let size = 0;
  const messages = body.messages.map((message, index) => {
    if (!message || message.role !== (index % 2 === 0 ? "user" : "assistant") ||
        typeof message.content !== "string" || !message.content.trim() || message.content.length > 12000)
      throw chatError("Messages must alternate user and assistant, contain text, and stay under 12,000 characters each.");
    size += Buffer.byteLength(message.content);
    return { role: message.role, content: message.content };
  });
  if (messages.at(-1).role !== "user" || size > 48000)
    throw chatError("End with a user message and keep the conversation under 48 KB.");
  const provider = body.provider ?? "auto";
  const model = body.model ?? "auto";
  if (!["auto", "openai", "anthropic"].includes(provider) || typeof model !== "string")
    throw chatError("Choose Auto, OpenAI or Anthropic and a supported model.");
  const conversationId = body.conversationId;
  if (conversationId !== undefined && (typeof conversationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)))
    throw chatError("Conversation ID must be a UUID.");
  return { messages, provider, model, ...(conversationId ? { conversationId } : {}) };
}
