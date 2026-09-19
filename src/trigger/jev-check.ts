import { AbortTaskRunError, task } from "@trigger.dev/sdk";
import { evaluateJev } from "../../lib/jev.js";

// Synthetic account/transport check. Never reads or modifies pipeline jobs.
export const jevCheckTask = task({
  id: "jev-check", maxDuration: 60, retry: { maxAttempts: 1 },
  run: async () => {
    const started = Date.now();
    try {
      const result = await evaluateJev({
        state: "This role is fully remote within the UK.", kind: "jev-check", ref: "jev-check",
        questions: {
          remote: { type: "boolean", instructions: "Does the text explicitly allow remote work?" },
          arrangement: { type: "choice", instructions: "Which working arrangement is stated?",
            criteria: { remote: "Fully remote", hybrid: "Office and remote", office: "Fully onsite", unknown: "Unspecified" } },
          clarity: { type: "score", instructions: "How clearly is the working arrangement described?",
            criteria: ["No arrangement stated", "Arrangement implied but ambiguous", "Arrangement explicitly stated"] },
        },
      });
      return { model: result.model, elapsedMs: Date.now() - started, answers: result.answers };
    } catch (error) {
      throw new AbortTaskRunError(error instanceof Error ? error.message : "Jev check failed.");
    }
  },
});
