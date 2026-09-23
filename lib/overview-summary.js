import { renderPrompt } from "./sanity/analysis-settings.js";
import { complete } from "./openai.js";
import { scoringInput } from "./jev-scoring.js";

export const OVERVIEW_MODEL = "gpt-5.6-sol";
export const OVERVIEW_POLICY = "2026-09-21-overview-1";

export async function summariseOverview(job, assessment, ref) {
  const { text } = await complete({
    model: OVERVIEW_MODEL, effort: "low", maxTokens: 1800, kind: "overview-summary", ref,
    system: { stable: renderPrompt('overview') },
    messages: [{ role: "user", content: JSON.stringify({ ...scoringInput(job), assessment: {
      score: assessment.score, dimensions: assessment.dimensions, posting: assessment.posting,
      constraint: assessment.constraint, blocked: assessment.blocked, provisional: assessment.provisional,
    } }) }],
  });
  let result;
  try { result = JSON.parse(text); } catch { /* Invalid output is retried by the durable worker. */ }
  if (!result || ["position", "fit"].some(key => typeof result[key] !== "string" || !result[key].trim() || result[key].length > 1200)) {
    throw Object.assign(new Error("Could not create the overview summary. Try again."), { status: 502 });
  }
  return { position: result.position.trim(), fit: result.fit.trim(), model: OVERVIEW_MODEL, policy: OVERVIEW_POLICY,
    fingerprint: assessment.fingerprint, assessedAt: assessment.assessedAt, generatedAt: new Date().toISOString() };
}
