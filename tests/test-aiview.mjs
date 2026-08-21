process.env.ADMIN_SECRET = "test-secret-value";
process.env.ANTHROPIC_API_KEY = "sk-fake";

// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

import fs from "node:fs";

globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" }) });

const { buildSystemPrompt, PROFILE_CONTEXT } = await import(base + "_profile.js");
const { buildCoverPrompt } = await import(base + "_cover.js");

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 200) : "")); } };

console.log("\n--- the profile carries the stance ---");
const P = PROFILE_CONTEXT;
check("section exists", P.includes("## What I want to bring on AI"));
check("part 1: in the product", P.includes("**AI in the product.**"));
check("part 2: ways of working", P.includes("**Ways of working with AI.**"));
check("part 3: teams and agents", P.includes("**Teams, engineers, and agents.**"));
check("keeps retrieval over generation", P.includes("retrieval over generation"));
check("keeps guardrails not gatekeepers", P.includes("Guardrails rather than gatekeepers"));
check("still zero em-dashes", !P.includes("\u2014"));

console.log("\n--- the analysis weaves it in, no dedicated slot ---");
const sys = buildSystemPrompt();
check("no ai_view field in the output shape", !sys.includes("ai_view"));
check("output shape is unchanged otherwise", sys.includes('"differentiators"') && sys.includes('"closing"'));
check("has the forward-looking section", sys.includes("## Bring a forward-looking view on AI"));
check("says not a section of its own", sys.includes("Not as a section of its own"));
check("points at the profile section", sys.includes('"What I want to bring on AI"'));
check("names where it may land", sys.includes("A differentiator is usually the right home"));
check("caps how far it spreads", sys.includes("Pick one or two places"));
check("prefers omission to vagueness", sys.includes("No AI note is far better than a vague one"));
check("bans knowing their strategy", sys.includes("Never claim to know their AI strategy"));
check("buys no extra words", sys.includes("None of this buys extra words"));

console.log("\n--- the letter lands on it as vision ---");
const cov = buildCoverPrompt({ report: { job_description: "x" }, fitUrl: "https://x" });
check("has the AI section", cov.includes("## Land the letter on AI"));
check("framed as forward-looking", cov.includes("forward-looking thought about AI in their business"));
check("voice is a manager rethinking team shape", cov.includes("keeps rethinking how engineering teams should work alongside AI"));
check("one of two angles is enough", cov.includes("one of them is enough"));
check("covers their business", cov.includes("Where AI could improve what they actually sell"));
check("covers how teams work", cov.includes("How their engineering teams could work differently"));
check("generic 'interesting thing' beat is gone", !cov.includes("genuinely interesting, thought through rather than flattered"));
check("precedes the closing link", cov.indexOf("forward-looking thought about AI") < cov.indexOf("Close: the fit-analysis link"));
check("bans industry predictions", cov.includes("No industry predictions"));
check("vision not certainty", cov.includes("Vision, not certainty"));
check("wants a named limit", cov.includes("Naming a limit or a tradeoff"));
check("still bound by length", cov.includes("Same word budget as any other paragraph"));

console.log("\n--- the fit page has no dedicated section ---");
const html = fs.readFileSync(root + "public/index.html", "utf8");
check("no ai_view render", !html.includes("ai_view"));
check("no aiview style", !html.includes("aiview"));
check("no 'Where AI fits' label", !html.includes("Where AI fits"));
check("existing sections intact", html.includes("Where I land") && html.includes("What sets me apart"));

console.log("\n--- per-role instructions still layer on top ---");
const steered = buildSystemPrompt({ instructions: "Lean on the agent architecture work." });
check("both present", steered.includes("## Bring a forward-looking view on AI") && steered.includes("Lean on the agent architecture work."));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
