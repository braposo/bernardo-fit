import { logger, otel } from "@trigger.dev/sdk";
import { estimateCostMicros, recordUsage } from "./usage.js";
import { setTimeout as delay } from "node:timers/promises";
import { promptIdentity, setPromptAttributes } from "./prompt-telemetry.js";
import { analysisSettings } from "./sanity/analysis-settings.js";

export const JEV_MODEL = "jev-1.13.0";
export const JEV_POLICY_VERSION = "2026-09-20-direct-1";
const TRIGGER_JEV_MODEL = "~typesafe/jev-latest";
const meter = otel.metrics.getMeter("fit-ai");
const jevCalls = meter.createCounter("fit.ai.jev.calls", { unit: "calls" });
const jevInput = meter.createCounter("fit.ai.jev.input_tokens", { unit: "tokens" });
const jevOutput = meter.createCounter("fit.ai.jev.output_tokens", { unit: "tokens" });
const jevCost = meter.createCounter("fit.ai.jev.estimated_cost_usd", { unit: "USD" });
const jevDuration = meter.createHistogram("fit.ai.jev.duration_ms", { unit: "ms" });
export const jevEnabled = (env = process.env) => !!env.TYPESAFE_API_KEY?.trim();
const invalid = () => Object.assign(new Error("Jev returned an invalid assessment. Try again."), { status: 502 });
const finite = (value, max = 1) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;

// Validate every requested answer before any decision can affect application state.
export function validateAnswers(data, questions) {
  const answers = {};
  for (const [key, question] of Object.entries(questions)) {
    const answer = data?.answers?.[key];
    if (!answer || answer.type !== (question.type === "boolean" ? "noul" : question.type)) throw invalid();
    const confidence = answer.confidence ?? null;
    if (confidence !== null && !finite(confidence)) throw invalid();
    if (question.type === "boolean") {
      if (!finite(answer.noul)) throw invalid();
      answers[key] = { type: "boolean", probability: answer.noul };
    } else {
      const keys = question.type === "choice" ? Object.keys(question.criteria) : question.criteria.map((_, i) => String(i));
      if (!answer.probabilities || keys.some(k => !finite(answer.probabilities[k])) ||
          Math.abs(keys.reduce((sum, k) => sum + answer.probabilities[k], 0) - 1) > 0.02) throw invalid();
      if (question.type === "choice" && !keys.includes(answer.choice)) throw invalid();
      if (question.type === "score" && !finite(answer.score, keys.length - 1)) throw invalid();
      answers[key] = { type: question.type, confidence,
        probabilities: Object.fromEntries(keys.map(k => [k, answer.probabilities[k]])),
        ...(question.type === "choice" ? { choice: answer.choice } : { score: answer.score }) };
    }
  }
  return answers;
}

export async function evaluateJev({ state, questions, kind, ref, signal: callerSignal, model = JEV_MODEL, promptRevision }) {
  if (!jevEnabled()) throw Object.assign(new Error("Configure TYPESAFE_API_KEY in Vercel and Trigger.dev to use Jev."), { status: 503, abort: true });
  const body = JSON.stringify({ model, state,
    questions: Object.fromEntries(Object.entries(questions).map(([id, q]) =>
      [id, q.type === "boolean" ? { ...q, type: "noul" } : q])) });
  // Bound inputs without silently dropping candidate evidence or posting requirements.
  if (Buffer.byteLength(body) > 100000) throw Object.assign(new Error("This assessment is too large for Jev. Shorten the role context."), { status: 400, abort: true });
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(30000)].filter(Boolean));
  const prompt = promptIdentity(kind, questions, promptRevision || analysisSettings().revision);
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    let status = 502, data, retryDelay = null;
    try {
      const result = await logger.trace("chat " + model, async span => {
        const callStarted = Date.now();
        // Outside a Trigger task, the SDK supplies a no-op span.
        const attribute = (name, value) => span.setAttribute?.(name, value);
        attribute("gen_ai.operation.name", "chat");
        attribute("gen_ai.provider.name", "typesafe");
        attribute("gen_ai.request.model", model);
        attribute("fit.ai.kind", kind || "");
        setPromptAttributes(attribute, prompt);
        attribute("fit.ai.attempt", attempt + 1);
        let completed = false;
        try {
          const response = await fetch("https://api.typesafe.ai/v1/systemone", {
            method: "POST", headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY.trim()}`, "Content-Type": "application/json" },
            body, signal,
          });
          status = response.status;
          if ([429, 529].includes(status) && attempt < 2) {
            const retryAfter = response.headers?.get("retry-after");
            const requested = retryAfter == null ? 0 : Number.isFinite(Number(retryAfter))
              ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
            const wait = Math.max(500 * 2 ** attempt, Number.isFinite(requested) ? requested : 0);
            // Keep the backoff outside the model span so its duration is the call latency.
            if (wait <= 5000) {
              await response.body?.cancel();
              retryDelay = wait;
              return null;
            }
          }
          if (!response.ok) throw Object.assign(new Error(`Jev evaluation failed (HTTP ${status}). Check TypeSafe access and budget.`),
            { status: status === 429 ? 503 : status >= 500 ? 502 : status, ...(status < 500 && status !== 429 ? { abort: true } : {}) });
          data = await response.json();
          if (data.model !== model) throw invalid();
          const answers = validateAnswers(data, questions);
          completed = true;
          return { answers, model };
        } finally {
          // Observability must not change the outcome of the model request.
          try {
            attribute("http.response.status_code", status);
            if (data?.model) {
              // Trigger prices this catalogue alias; TypeSafe returns the pinned version.
              const catalogModel = model === JEV_MODEL && data.model === JEV_MODEL ? TRIGGER_JEV_MODEL : data.model;
              attribute("gen_ai.response.model", catalogModel);
              attribute("fit.ai.provider_response_model", data.model);
            }
            const dimensions = { model, kind: kind || "", http_status: String(status) };
            jevCalls.add(1, dimensions);
            jevDuration.record(Date.now() - callStarted, dimensions);
            if (data?.usage) {
              const input = data.usage.input_tokens, output = data.usage.output_tokens;
              if (Number.isFinite(input) && input >= 0) {
                attribute("gen_ai.usage.input_tokens", input);
                jevInput.add(input, dimensions);
              }
              if (Number.isFinite(output) && output >= 0) {
                attribute("gen_ai.usage.output_tokens", output);
                jevOutput.add(output, dimensions);
              }
              const cost = estimateCostMicros({ model, input, output });
              if (cost !== null) {
                attribute("fit.ai.estimated_cost_usd", cost / 1e6);
                if (cost > 0) jevCost.add(cost / 1e6, dimensions);
              }
            }
            attribute("gen_ai.response.finish_reasons", JSON.stringify([completed ? "stop" : "error"]));
          } catch (telemetryError) {
            console.error("Jev telemetry failed (non-fatal):", String(telemetryError).slice(0, 200));
          }
        }
      });
      if (retryDelay !== null) {
        await delay(retryDelay, undefined, { signal });
        continue;
      }
      return result;
    } catch (error) {
      if (status < 400) status = 502;
      if (error?.status) throw error;
      throw Object.assign(new Error("Jev could not complete the assessment. Try again."), { status: 502 });
    } finally {
      await recordUsage({ kind, ref, model, effort: "none", ms: Date.now() - started, httpStatus: status,
        generationAttempt: attempt + 1, usage: data?.usage });
    }
  }
}
