// The AI SDK records these OpenTelemetry GenAI attributes for chat. The raw
// provider clients use the same shape so Trigger can display their content too.
const text = content => ({ type: "text", content });
const asText = value => typeof value === "string" ? value : JSON.stringify(value);

function inputPart(part) {
  if (part?.type === "text" || part?.type === "input_text") return text(part.text);
  if (["thinking", "tool_use", "web_search_tool_result"].includes(part?.type)) return outputPart(part);
  return text(asText(part));
}

function inputMessage(message) {
  return { role: message.role, parts: typeof message.content === "string"
    ? [text(message.content)] : (message.content || []).map(inputPart) };
}

function outputPart(part) {
  if (["text", "output_text"].includes(part?.type)) return text(part.text);
  if (part?.type === "thinking") return { type: "reasoning", content: part.thinking };
  if (part?.type === "tool_use") return { type: "tool_call", id: part.id || null,
    name: part.name, arguments: part.input };
  if (part?.type === "web_search_tool_result") return { type: "tool_call_response",
    id: part.tool_use_id || null, response: part.content };
  return text(asText(part));
}

export function setModelContentAttributes(attribute, { provider, request, data }) {
  if (provider === "typesafe") {
    attribute("gen_ai.input.messages", JSON.stringify([{ role: "user", parts: [text(JSON.stringify({
      state: request.state, questions: request.questions,
    }))] }]));
    if (data?.answers) attribute("gen_ai.output.messages", JSON.stringify([
      { role: "assistant", parts: [text(JSON.stringify(data.answers))] },
    ]));
    return;
  }

  const system = provider === "openai" ? request.instructions : request.system;
  if (system) attribute("gen_ai.system_instructions", JSON.stringify(
    typeof system === "string" ? [text(system)] : system.map(block => text(block.text))));
  attribute("gen_ai.input.messages", JSON.stringify((request.input || request.messages || []).map(inputMessage)));
  if (request.tools?.length) attribute("gen_ai.tool.definitions", JSON.stringify(request.tools));

  if (!data) return;
  const parts = provider === "openai"
    ? (data.output || []).flatMap(item => item.type === "message"
      ? (item.content || []).map(outputPart)
      : item.type === "web_search_call" ? [{ type: "tool_call", id: item.id || null,
        name: "web_search", arguments: item.action }] : [outputPart(item)])
    : (data.content || []).map(outputPart);
  if (parts.length) attribute("gen_ai.output.messages", JSON.stringify([{ role: "assistant", parts }]));
}
