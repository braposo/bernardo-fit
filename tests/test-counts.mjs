process.env.ANTHROPIC_API_KEY = "sk-fake";

// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

const { PROSE_RULES } = await import(base + "_writing.js");
const { PROFILE_CONTEXT, buildSystemPrompt } = await import(base + "_profile.js");
const { buildCoverPrompt } = await import(base + "_cover.js");

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 160) : "")); } };

const sys = buildSystemPrompt();
const cov = buildCoverPrompt({ report: { job_description: "x" }, fitUrl: "https://x" });

console.log("\n--- the profile no longer caps me with counts ---");
const capping = [
  ["team size", /three engineers/i],
  ["hires", /\bHired \d/],
  ["promotions", /\d+ internal promotions/],
  ["how many times", /from scratch twice/i],
  ["early-employee rank", /first 10 engineers|employee #\d/i],
  ["replatformings", /two (major )?replatformings/i],
  ["promotion grades", /G3|G4|G5/],
];
for (const [name, re] of capping) {
  const m = PROFILE_CONTEXT.match(re);
  check("no " + name + " count", !m, m && m[0]);
}
check("the experience is still there", /built design systems from scratch/.test(PROFILE_CONTEXT));
check("hiring is still there", /Hired engineers onto the team/.test(PROFILE_CONTEXT));
check("promotions are still there", /Drove internal promotions/.test(PROFILE_CONTEXT));
check("early-stage is still there", /one of the first engineers/.test(PROFILE_CONTEXT));

console.log("\n--- the rule is stated, and shared by both pieces ---");
check("rule exists", PROSE_RULES.includes("Never count my own experience"));
check("names team size", PROSE_RULES.includes("how many people I managed"));
check("names hires and promotions", PROSE_RULES.includes("how many I hired or promoted"));
check("names repetitions", PROSE_RULES.includes("how many times I have done something"));
check("explains why", PROSE_RULES.includes("reads as a ceiling"));
check("gives the relative reframe", PROSE_RULES.includes("smaller team sitting inside a much larger engineering organisation"));
check("overrides the profile", PROSE_RULES.includes("The profile is what I know, not what you write"));
check("scale numbers still allowed", PROSE_RULES.includes("Numbers about reach, traffic, revenue or volume are different"));
check("no longer endorses 'three engineers'", !PROSE_RULES.includes("three engineers"));
check("analysis prompt carries it", sys.includes("Never count my own experience"));
check("cover prompt carries it", cov.includes("Never count my own experience"));

console.log("\n--- counts the model derives itself are banned too ---");
check("list-to-count named", PROSE_RULES.includes("Do not turn a list into a count"));
check("twice banned in the shared rule", PROSE_RULES.includes('"twice"'));
check("two companies banned", PROSE_RULES.includes('"at two companies"'));
check("both times banned", PROSE_RULES.includes('"both times"'));
check("headlines covered", PROSE_RULES.includes("headlines and labels"));

console.log("\n--- and hoisted, because a buried rule does not fire ---");
const top = sys.indexOf("## Read this first: never count my own experience");
check("analysis rule sits at the top", top !== -1 && top < sys.indexOf("## The most important rule"));
check("analysis gives the worked example", sys.includes("Never \"I've built design systems from scratch twice\""));
check("analysis covers every field", sys.includes("in any field, including headlines"));
check("analysis says naming is fine", sys.includes("Naming them is right. Adding them up is not."));
check("cover rule is hoisted", cov.indexOf("## Never count my own experience") < cov.indexOf("## Write it for them"));
check("cover names the trap", cov.includes('not "at two companies"'));

console.log("\n--- the seniority guidance says it too ---");
check("does not print the headcount", !/headcount I directly managed as an EM \(three/.test(sys));
check("tells it to go relative", sys.includes("know how the fundamentals scale"));
check("bans stating the number", sys.includes("Never state that number"));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
