import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { loadChatSettings } from "./settings.js";
import { evaluateJev, jevEnabled } from "../jev.js";
import { chatError } from "./policy.js";

const keyName = provider => provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
export function chatModels(env, settings) {
  return settings.models.filter(model => model.enabled).map(({id,label,provider}) => ({id,label,provider,
    available: !!env[keyName(provider)]?.trim()}));
}

export async function selectChatModel(request, { env = process.env, evaluate = evaluateJev, ref = "admin-chat", signal, settings } = {}) {
  settings ||= await loadChatSettings({env,signal});
  const provenance = {policy:settings.policy,settingsRevision:settings.revision,settingsFingerprint:settings.fingerprint,jevModel:settings.jevModel};
  const catalog = chatModels(env, settings);
  if (request.model !== "auto") {
    const selected = catalog.find(model => model.id === request.model);
    if (!selected || (request.provider !== "auto" && selected.provider !== request.provider))
      throw chatError("That model does not match the selected provider.");
    if (!selected.available) throw chatError("The selected provider is not configured.", 503, "CHAT_PROVIDER_UNAVAILABLE");
    return { model: selected.id, provider: selected.provider, source: "manual", ...provenance };
  }
  const candidates = catalog.filter(model => model.available && (request.provider === "auto" || model.provider === request.provider));
  if (!candidates.length) throw chatError("No chat provider is configured.", 503, "CHAT_PROVIDER_UNAVAILABLE");
  if (!jevEnabled(env)) throw chatError("Auto selection requires Jev. Select a model manually or configure Jev.", 503, "CHAT_ROUTER_UNAVAILABLE");
  const criteria = Object.fromEntries(candidates.map(model => [model.id, settings.models.find(m=>m.id===model.id).description]));
  let answer;
  try {
    const result = await evaluate({ state: { messages: request.messages }, kind: "admin-chat-route", ref, signal, model:settings.jevModel,
      promptRevision: settings.revision,
      questions: { model: { type: "choice", instructions: settings.routingInstructions, criteria } } });
    answer = result.answers.model;
  } catch {
    throw chatError("Jev could not choose a model. Retry or select one manually.", 503, "CHAT_ROUTER_UNAVAILABLE");
  }
  if (!candidates.some(model => model.id === answer?.choice)) throw chatError("Jev returned an unsupported model.", 502, "CHAT_ROUTER_INVALID");
  const probability = answer.probabilities?.[answer.choice];
  const uncertain = !Number.isFinite(answer.confidence) || answer.confidence < settings.confidenceThreshold || !Number.isFinite(probability) || probability < settings.probabilityThreshold;
  const fallback = [...candidates].sort((a,b)=>settings.models.find(m=>m.id===a.id).fallbackPriority - settings.models.find(m=>m.id===b.id).fallbackPriority)[0];
  const selected = uncertain ? fallback.id : answer.choice;
  return { model: selected, provider: candidates.find(m=>m.id===selected).provider, source: "jev", ...provenance,
    jevChoice: answer.choice, probability, fallbackUsed: uncertain,
    confidence: answer.confidence, reason: uncertain ? "Uncertain routing; selected a capable model within your provider choice." : criteria[selected] };
}

export function chatLanguageModel(route, env = process.env) {
  return route.provider === "openai"
    ? createOpenAI({ apiKey: env.OPENAI_API_KEY }).responses(route.model)
    : createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(route.model);
}
