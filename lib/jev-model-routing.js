import { settingsQuestion, settingsFingerprint } from "./sanity/analysis-settings.js";
import { evaluateJev, jevEnabled, JEV_MODEL, JEV_POLICY_VERSION } from "./jev.js";
import { resolveModel } from "./models.js";
import { digest } from "./generation-fingerprint.js";
import { getTaskInput, saveTaskInput } from "./task-results.js";

const POLICY = "writing-model-1";
// Persist the decision so review, submission and retries agree on one model.
export async function selectWritingModel({ kind, job, report, questionId = "", fallback }) {
  if (!jevEnabled()) return { model: resolveModel(fallback), source: "configured" };
  const question = settingsQuestion("writingModel");
  const criteria = question.criteria;
  const state = { kind: ["brief", "prepare-screen"].includes(kind) ? "prepare-screen" : kind, company: job?.company, role: job?.role,
    description: job?.jobDescription || "", instructions: job?.instructions || "",
    notes: job?.notes || "", report: report || null,
    question: (job?.questions || []).find(q => q.id === questionId) || null };
  // Exclude run pointers/timestamps so submitting a review cannot invalidate it.
  if (state.question) state.question = { q: state.question.q, limit: state.question.limit };
  const key = digest({ policy: POLICY, settings: settingsFingerprint(), model: JEV_MODEL, transportPolicy: JEV_POLICY_VERSION, state, criteria });
  const cached = await getTaskInput("jev-model-route", key);
  if (cached) return cached;
  const { answers } = await evaluateJev({ state, kind: "jev-model-route", ref: job?.id || "batch", questions: {
    model: question,
  } });
  const answer = answers.model;
  const uncertain = answer.probabilities[answer.choice] < 0.8 || answer.confidence === null || answer.confidence < 0.8;
  return saveTaskInput("jev-model-route", key, { model: uncertain ? "gpt-5.6-sol" : answer.choice,
    source: "jev", policy: POLICY, confidence: answer.confidence,
    reason: uncertain ? "Uncertain routing: use balanced Sol." : criteria[answer.choice] });
}
