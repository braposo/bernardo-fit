process.env.ANTHROPIC_API_KEY = "sk-fake";
// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

const { PROFILE_CONTEXT: P, buildSystemPrompt } = await import(base + "_profile.js");
const { buildCoverPrompt } = await import(base + "_cover.js");
const { buildAnswerPrompt } = await import(base + "_answer.js");

let pass = 0, fail = 0;
const check = (n, c, e) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 200) : "")); }
};

const entry = P.slice(P.indexOf("**Fit**"), P.indexOf("**The Hermans.**"));

console.log("\n--- the project is in the profile ---");
check("entry exists", P.includes("**Fit** (fit.bernardoraposo.com)"));
check("leads the projects section", P.indexOf("**Fit**") < P.indexOf("**The Hermans.**"));
check("says what it does", entry.includes("paste a job description"));
check("covers the pipeline it grew into", entry.includes("daily scan of my inbox"));

console.log("\n--- how it was built is stated plainly ---");
check("directed rather than typed", entry.includes("I directed it and made the design calls"));
check("names the agent", entry.includes("Claude Code wrote most of the code"));
check("claims the parts that were his", entry.includes("set the architecture") && entry.includes("debugged the parts that broke"));
check("no overclaiming", !/I wrote every line|I built it alone|hand-coded/i.test(entry));

console.log("\n--- the stack ---");
check("Vercel", entry.includes("Vercel serverless functions"));
check("Redis", entry.includes("Upstash Redis"));
check("Anthropic API", entry.includes("Anthropic API"));
check("no framework, and framed as a decision", entry.includes("no framework and no build step") && entry.includes("decision rather than a shortcut"));

console.log("\n--- the engineering, not the CRUD ---");
check("prompts as a surface", entry.includes("treating prompts as a surface"));
check("word budgets and primacy", entry.includes("hard word budgets") && entry.includes("top of the prompt"));
check("shared writing rules", entry.includes("one shared module"));
check("privacy of the score", entry.includes("stripped before the report is saved and again when it's read"));
check("signed tokens", entry.includes("short-lived signed tokens"));
check("the dedup bug", entry.includes("dedupe on a hash of the job description"));
check("tests", entry.includes("assertions"));

console.log("\n--- Claude Design and the skills ---");
check("design came through Claude Design", entry.includes("Design came through Claude Design"));
check("letter template too", entry.includes("cover letter template"));
check("print via the browser, and why", entry.includes("rather than shipping a headless browser"));
check("built the skills", entry.includes("I also built the skills that feed it"));
check("profile skill", entry.includes("holds my profile and career detail"));
check("anti-slop skill", entry.includes("anti-slop writing rules"));
check("why skills are the unit", entry.includes("Skills turned out to be the useful unit"));

console.log("\n--- it reaches everything that writes ---");
check("the analysis sees it", buildSystemPrompt().includes("**Fit** (fit.bernardoraposo.com)"));
check("the letter sees it", buildCoverPrompt({ report: { job_description: "x" }, fitUrl: "https://x" }).includes("fit.bernardoraposo.com"));
check("form answers see it", buildAnswerPrompt({ question: "What have you shipped?", limit: 100 }).includes("fit.bernardoraposo.com"));

console.log("\n--- the AI section no longer rests only on SingleStore ---");
check("cites the project", P.includes("Fit is the working proof of it"));
check("still inside that section", P.indexOf("Fit is the working proof") > P.indexOf("## What I want to bring on AI"));

console.log("\n--- house style holds ---");
check("no em-dashes", !entry.includes("\u2014"));
const sentences = entry.split(/(?<=[.!?])\s+/).filter(Boolean).map((s) => s.trim().split(/\s+/).length);
const avg = sentences.reduce((a, b) => a + b, 0) / sentences.length;
check("average sentence under 20 words", avg < 20, avg.toFixed(1));
check("no sentence over 25 words", Math.max(...sentences) <= 25, Math.max(...sentences));
check("no counts of my own experience", !/\btwice\b|three engineers|\bHired \d|G3|G4|G5/i.test(entry));
check("uses contractions", /don't|I've|it's|wasn't/.test(entry));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
