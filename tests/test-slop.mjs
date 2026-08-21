process.env.ANTHROPIC_API_KEY = "sk-fake";
// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

const B = "file:///" + root + "api/";
const { SLOP_TOP, ANTI_SLOP } = await import(B + "_writing.js");
const { buildSystemPrompt } = await import(B + "_profile.js");
const { buildCoverPrompt } = await import(B + "_cover.js");
const { buildAnswerPrompt } = await import(B + "_answer.js");

let pass = 0, fail = 0;
const check = (n, c, e) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 200) : "")); }
};

const prompts = {
  analysis: buildSystemPrompt(),
  cover: buildCoverPrompt({ report: { job_description: "x" }, fitUrl: "https://x" }),
  answer: buildAnswerPrompt({ question: "Why us?", limit: 100 }),
};

console.log("\n--- the full rule set matches the skill ---");
const A = ANTI_SLOP.toLowerCase();
const words = ["delve","foster","leverage","utilize","facilitate","empower","streamline","robust","cutting-edge","paradigm shift","game changer","this is huge","this changes everything","tapestry","realm","beacon","multifaceted","meticulous","intricate","paramount","transformative","elevate","embark","supercharge","harness","ever-evolving"];
const advs = ["just","literally","honestly","simply","actually","truly","fundamentally","importantly","crucially","inherently","inevitably"];
const phrases = ["it's worth noting","it's important to note","at the end of the day","when it comes to","at its core","in today's world","in the age of","in the world of","the reality is","the truth is","in terms of","with regard to","in order to","going forward","in this article","let's dive in"];
const patterns = ["binary contrast","robotic rhythm","throat-clearing","faux-insight","colon reveal","superficial analysis","interpretive metadiscourse","importance puffery","weasel attribution","fake-strong verb","synonym cycling","negative listing","dramatic fragmentation","rhetorical setup","fake-profound kicker","recap ending","em-dash"];
check("every banned word present", words.every((w) => A.includes(w)), words.filter((w) => !A.includes(w)));
check("every empty adverb present", advs.every((w) => A.includes(w)), advs.filter((w) => !A.includes(w)));
check("every empty phrase present", phrases.every((w) => A.includes(w)), phrases.filter((w) => !A.includes(w)));
check("every pattern present", patterns.every((w) => A.includes(w)), patterns.filter((w) => !A.includes(w)));
check("portability test carried over", ANTI_SLOP.includes("could move unchanged into a piece about a different person"));

console.log("\n--- the trailing negation, which is what actually broke ---");
check("named in the hoisted block", SLOP_TOP.includes("the trailing form"));
check("named in the full rules", ANTI_SLOP.includes('never the trailing form'));
check("worked examples given", SLOP_TOP.includes("not before") && SLOP_TOP.includes("not less"));
check("each example has a fix", (SLOP_TOP.match(/Right:/g) || []).length >= 5);
check("flagged as the most frequent break", ANTI_SLOP.includes("This is the rule that breaks most often"));

console.log("\n--- robotic rhythm, which was missing entirely ---");
check("in the hoisted block", SLOP_TOP.includes("The same shape twice"));
check("covers paragraph endings", SLOP_TOP.includes("If two paragraphs end on the same construction"));
check("in the full rules", ANTI_SLOP.includes("Do not repeat a sentence shape across paragraphs"));

console.log("\n--- fake-profound kickers now cover any paragraph ---");
check("not only the closing", ANTI_SLOP.includes("This applies to any paragraph, not only the last one"));
check("delete rather than improve", ANTI_SLOP.includes("Don't rewrite the metaphor into a better one"));

console.log("\n--- hoisted into all three prompts ---");
for (const [name, p] of Object.entries(prompts)) {
  check(name + ": hoisted block present", p.includes("Read this first: the tells that keep slipping through"));
  check(name + ": full rules present", p.includes("Robotic rhythm"));
  check(name + ": hoisted before the full rules", p.indexOf("the tells that keep slipping through") < p.lastIndexOf("Synonym cycling"));
  check(name + ": no unresolved templates", !p.includes("${"));
}
check("cover: ahead of the shape", prompts.cover.indexOf("the tells that keep") < prompts.cover.indexOf("## Shape"));
check("analysis: in the opening rules", prompts.analysis.indexOf("the tells that keep") < prompts.analysis.indexOf("## My career"));
check("answer: ahead of the question", prompts.answer.indexOf("the tells that keep") < prompts.answer.indexOf("## The question"));

console.log("\n--- the prompt no longer teaches a flourish ---");
check("planted metaphor removed", !prompts.cover.includes("wearing different clothes"));
check("the worked example survives", prompts.cover.includes("pulling two products onto one platform"));

console.log("\n--- the rules do not break their own rules ---");
// One em-dash is legitimate: the rule has to quote the character to name it.
// Any more than that and the prompt is modelling the habit it bans.
for (const [name, p] of Object.entries(prompts)) {
  const found = [...p.matchAll(/\u2014/g)].map((m) => m.index);
  check(name + ": exactly one em-dash", found.length === 1, found.length);
  check(name + ": and it is the one being quoted", found.length === 1 && p.slice(found[0] - 40, found[0]).includes("Em-dashes"));
}

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
