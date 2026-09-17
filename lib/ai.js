import { complete as anthropic } from "./anthropic.js";
import { complete as openai } from "./openai.js";
import { modelProvider, resolveModel } from "./models.js";

// The selected model determines the provider. Errors never silently switch it.
export function complete(options) {
  const model = resolveModel(options.model);
  return (modelProvider(model) === "openai" ? openai : anthropic)({ ...options, model });
}
