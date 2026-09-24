import { ToolLoopAgent, isStepCount } from "ai";
import { chatLanguageModel } from "./models.js";
import { recordUsage } from "../usage.js";
import { promptIdentity } from "../prompt-telemetry.js";

export function providerUsage(usage) {
  const details = usage?.inputTokenDetails || {};
  return usage ? { input_tokens: details.noCacheTokens ?? Math.max(0, (usage.inputTokens || 0) - (details.cacheReadTokens || 0) - (details.cacheWriteTokens || 0)),
    output_tokens: usage.outputTokens || 0, cache_read_input_tokens: details.cacheReadTokens || 0,
    cache_creation_input_tokens: details.cacheWriteTokens || 0 } : undefined;
}

export function createChatAgent({ route, context, ref, settings, makeModel = chatLanguageModel, record = recordUsage }) {
  let started = Date.now();
  const prompt = promptIdentity("admin-chat", [settings.assistantInstructions, settings.contextInstructions], settings.revision);
  return new ToolLoopAgent({
    model: makeModel(route),
    instructions: [settings.assistantInstructions, settings.contextInstructions, context.initialContext].join("\n\n"),
    tools: context.tools,
    maxOutputTokens: settings.maxOutputTokens,
    maxRetries: 0,
    stopWhen: isStepCount(settings.maxSteps),
    experimental_telemetry: { isEnabled: true, recordInputs: false, recordOutputs: false,
      includeRuntimeContext: { promptTelemetry: true } },
    runtimeContext: { promptTelemetry: prompt },
    // Leave the final step for an answer rather than ending on another query.
    prepareStep: ({ stepNumber }) => ({ toolChoice: stepNumber >= settings.maxSteps - 1 ? "none" : "auto" }),
    ...(route.provider === "openai" ? { providerOptions: { openai: { store: false } } } : {}),
    onStepStart: () => { started = Date.now(); },
    onStepEnd: async step => record({ kind: "admin-chat", ref, model: route.model, effort: "default",
      usage: providerUsage(step.usage), ms: Date.now() - started, stopReason: step.finishReason,
      httpStatus: ["error", "content-filter"].includes(step.finishReason) ? 502 : 200 }),
  });
}
