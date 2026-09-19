// Synthetic, read-only account check. Never prints credentials or loads job data.
import { evaluateJev } from "../lib/jev.js";
if (!process.env.TYPESAFE_API_KEY?.trim()) {
  console.error("Set TYPESAFE_API_KEY in .env.local or your environment first.");
  process.exit(1);
}
try {
  const started = Date.now();
  const result = await evaluateJev({ state: "This role is fully remote within the UK.",
    questions: {
      remote: { type: "boolean", instructions: "Does the posting explicitly allow remote work?" },
      arrangement: { type: "choice", instructions: "What working arrangement is explicitly stated?",
        criteria: { remote: "Fully remote", hybrid: "Mix of office and remote", office: "Fully onsite", unknown: "Unspecified" } },
      clarity: { type: "score", instructions: "How clearly does the text describe the working arrangement?",
        criteria: ["No working arrangement stated", "Arrangement implied but ambiguous", "Arrangement explicitly stated"] },
    }, kind: "jev-check", ref: "jev-check" });
  console.log(JSON.stringify({ model: result.model, elapsedMs: Date.now() - started,
    remoteProbability: result.answers.remote.probability, arrangement: result.answers.arrangement,
    clarity: result.answers.clarity }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
