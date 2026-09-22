import { settingsQuestion } from "./sanity/analysis-settings.js";
import { evaluateJev, jevEnabled } from "./jev.js";
import { PUBLIC_MODEL } from "./models.js";

export async function routeAnswer(policy, { question, economy, instructions, report, ref }) {
  if (!jevEnabled() || !economy || policy.fact || policy.compact || !report?.pitch || String(instructions || "").trim()) return policy;
  try {
    const { answers } = await evaluateJev({ state: { question }, kind: "jev-route", ref, questions: {
      route: settingsQuestion("routineRoute"),
    } });
    const route = answers.route;
    if (route.choice === "routine" && route.probabilities.routine >= 0.95 && route.confidence !== null && route.confidence >= 0.8) {
      return { ...policy, compact: true, model: PUBLIC_MODEL, effort: "medium", routing: "jev-routine" };
    }
    return { ...policy, routing: "jev-full" };
  } catch {
    // An unavailable classifier must never turn a question into a cheaper, less informed answer.
    return { ...policy, routing: "jev-unavailable-full" };
  }
}
