// Synthetic, read-only account check. Never prints credentials or loads job data.
import { evaluateJev } from "../lib/jev.js";
if (!process.env.AI_GATEWAY_API_KEY?.trim()) {
  console.error("Set AI_GATEWAY_API_KEY in .env.local or your environment first.");
  process.exit(1);
}
try {
  const result = await evaluateJev({ state: "This role is fully remote within the UK.",
    questions: { remote: { type: "boolean", instructions: "Does the posting explicitly allow remote work?" } }, kind: "jev-check", ref: "jev-check" });
  console.log(JSON.stringify({ model: result.model, remoteProbability: result.answers.remote.probability }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
