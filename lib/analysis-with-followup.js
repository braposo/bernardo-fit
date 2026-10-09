import { executeAnalysisWork } from "./analysis-work.js";
import { reviewingGenerationResult } from "./reviewing-generation.js";

export async function executeAnalysisWithFollowup(payload) {
  const result = await executeAnalysisWork(payload);
  const followup = payload.jobId && result.outcome === "completed"
    ? await reviewingGenerationResult({ id: payload.jobId }, { fromWorker: true }) : null;
  return { ...result, ...(followup?.generationErrors.length ? { generationErrors: followup.generationErrors } : {}) };
}
