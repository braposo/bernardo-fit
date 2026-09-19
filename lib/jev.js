import { recordUsage } from "./usage.js";
import { setTimeout as delay } from "node:timers/promises";

export const JEV_MODEL = "jev-1.13.0";
export const JEV_POLICY_VERSION = "2026-09-20-direct-1";
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

export async function evaluateJev({ state, questions, kind, ref }) {
  if (!jevEnabled()) throw Object.assign(new Error("Configure TYPESAFE_API_KEY in Vercel and Trigger.dev to use Jev."), { status: 503, abort: true });
  const body = JSON.stringify({ model: JEV_MODEL, state,
    questions: Object.fromEntries(Object.entries(questions).map(([id, q]) =>
      [id, q.type === "boolean" ? { ...q, type: "noul" } : q])) });
  // Bound inputs without silently dropping candidate evidence or posting requirements.
  if (Buffer.byteLength(body) > 100000) throw Object.assign(new Error("This assessment is too large for Jev. Shorten the role context."), { status: 400, abort: true });
  const signal = AbortSignal.timeout(30000);
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    let status = 502, data;
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
        // Don't retry sooner than requested. Long delays return to the caller's
        // durable retry/review path rather than tying up an HTTP review request.
        if (wait <= 5000) {
          await response.body?.cancel();
          await delay(wait, undefined, { signal });
          continue;
        }
      }
      if (!response.ok) throw Object.assign(new Error(`Jev evaluation failed (HTTP ${status}). Check TypeSafe access and budget.`),
        { status: status === 429 ? 503 : status >= 500 ? 502 : status, ...(status < 500 && status !== 429 ? { abort: true } : {}) });
      data = await response.json();
      if (data.model !== JEV_MODEL) throw invalid();
      const answers = validateAnswers(data, questions);
      return { answers, model: JEV_MODEL };
    } catch (error) {
      if (status < 400) status = 502;
      if (error?.status) throw error;
      throw Object.assign(new Error("Jev could not complete the assessment. Try again."), { status: 502 });
    } finally {
      await recordUsage({ kind, ref, model: JEV_MODEL, effort: "none", ms: Date.now() - started, httpStatus: status,
        generationAttempt: attempt + 1, usage: data?.usage });
    }
  }
}
