import { logger } from "@trigger.dev/sdk";
import { setPromptAttributes } from "./prompt-telemetry.js";

const nonnegative = value => typeof value === "number" && Number.isFinite(value) && value >= 0;

// One span per provider HTTP request. Keeping the parse inside the span lets
// Trigger attach the returned model and usage even when the caller later rejects
// a refusal or an incomplete response.
export async function traceModelRequest({ provider, model, kind, attempt, continuation, maxTokens, prompt }, request) {
  return logger.trace("chat " + model, async span => {
    const attribute = (name, value) => span.setAttribute?.(name, value);
    let status = 0, data;
    try {
      const response = await request();
      status = response.status || 0;
      if (response.ok) data = await response.json();
      return { response, data };
    } finally {
      // Telemetry must never change the provider call's result.
      try {
        attribute("gen_ai.operation.name", "chat");
        attribute("gen_ai.provider.name", provider);
        attribute("gen_ai.request.model", model);
        attribute("gen_ai.request.max_tokens", maxTokens);
        attribute("fit.ai.kind", kind || "");
        setPromptAttributes(attribute, prompt);
        attribute("fit.ai.attempt", attempt);
        if (continuation !== undefined) attribute("fit.ai.continuation", continuation);
        if (status) attribute("http.response.status_code", status);
        attribute("gen_ai.response.model", data?.model || model);
        const usage = data?.usage;
        if (usage) {
          const cacheRead = provider === "openai" ? usage.input_tokens_details?.cached_tokens : usage.cache_read_input_tokens;
          const cacheWrite = provider === "openai" ? usage.input_tokens_details?.cache_write_tokens : usage.cache_creation_input_tokens;
          // OpenAI input_tokens is total; Anthropic input_tokens excludes cache reads/writes.
          const input = provider === "anthropic" && nonnegative(usage.input_tokens)
            ? usage.input_tokens + (nonnegative(cacheRead) ? cacheRead : 0) + (nonnegative(cacheWrite) ? cacheWrite : 0)
            : usage.input_tokens;
          if (nonnegative(input)) attribute("gen_ai.usage.input_tokens", input);
          if (nonnegative(usage.output_tokens)) attribute("gen_ai.usage.output_tokens", usage.output_tokens);
          if (nonnegative(cacheRead)) attribute("gen_ai.usage.cache_read.input_tokens", cacheRead);
          if (nonnegative(cacheWrite)) attribute("gen_ai.usage.cache_creation.input_tokens", cacheWrite);
        }
        const finish = provider === "anthropic" ? data?.stop_reason
          : data?.status === "completed" ? "stop" : data?.incomplete_details?.reason || data?.status;
        attribute("gen_ai.response.finish_reasons", JSON.stringify([finish || "error"]));
      } catch (error) {
        console.error("AI telemetry failed (non-fatal):", String(error).slice(0, 200));
      }
    }
  });
}
