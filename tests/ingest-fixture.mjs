import { FIT_DIMENSIONS, scoringFingerprint } from "../lib/jev-scoring.js";

// Persistence/matching regressions use a passing assessor fixture. The real
// TypeSafe-to-admission path is exercised separately in test-ingest-screening.
export async function passingScreen(opportunity) {
  return { decision: "accepted", assessment: {
    model: "jev-1.13.0", policy: "fixture", fingerprint: scoringFingerprint(opportunity),
    assessedAt: "2026-09-19T12:00:00Z", score: 75, status: "complete", blocked: false,
    dimensions: FIT_DIMENSIONS.map(({ id, label, weight }) => ({ id, label, weight, score: 75, confidence: 0.9, evidenceProbability: 1 })),
    posting: { choice: "complete" }, constraint: { choice: "clear" },
  } };
}
