// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

// Guards the shared writing rules and the cover letter's specificity section.
const { ANTI_SLOP, PROSE_RULES } = await import(base + "_writing.js");
const { buildSystemPrompt } = await import(base + "_profile.js");
const { buildCoverPrompt } = await import(base + "_cover.js");

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e) : "")); } };

const PATTERNS = [
  "Binary contrasts", "Throat-clearing", "Faux-insight", "Colon reveals",
  "Importance puffery", "Fake-strong verbs", "Synonym cycling", "Negative listing",
  "Dramatic fragmentation", "Rhetorical setups", "Fake-profound kickers",
  "Recap endings", "Em-dashes",
];
const BANNED = ["delve", "leverage", "robust", "transformative", "harness", "ever-evolving"];

console.log("\n--- the shared module carries the full rule set ---");
PATTERNS.forEach((p) => check("pattern: " + p, ANTI_SLOP.includes(p)));
check("banned words listed", BANNED.every((w) => ANTI_SLOP.includes(w)));
check("empty adverbs listed", ANTI_SLOP.includes("literally") && ANTI_SLOP.includes("crucially"));
check("prose rules cover contractions", /contractions/i.test(PROSE_RULES));
check("prose rules cover number restraint", /sparing with numbers/i.test(PROSE_RULES));
check("prose rules cover sentence length", /sentences short/i.test(PROSE_RULES));

const fit = buildSystemPrompt();
const report = {
  job_title: "Head of Engineering", company: "Sanity",
  job_description: "We run squads. Next.js and TypeScript. Colin is the hiring manager.",
  pitch: "p", categories: [{ name: "Technical fit", note: "n" }], differentiators: [], closing: "c",
};
const cover = buildCoverPrompt({ report, fitUrl: "https://fit.bernardoraposo.com/?r=abc" });

console.log("\n--- both prompts inherit the same rules ---");
PATTERNS.forEach((p) => check("fit prompt has: " + p, fit.includes(p)));
console.log();
PATTERNS.forEach((p) => check("cover prompt has: " + p, cover.includes(p)));
check("no drift: identical rule text in both", fit.includes(ANTI_SLOP) && cover.includes(ANTI_SLOP));
check("prose rules in both", fit.includes(PROSE_RULES) && cover.includes(PROSE_RULES));

console.log("\n--- cover-specific specificity guidance ---");
[
  ["the paste test", "Could this paragraph be pasted"],
  ["name the company", "Never \"your company\""],
  ["mine the JD", "Mine it"],
  ["borrow their vocabulary", "Borrow their vocabulary"],
  ["address the named hirer", "names the person hiring"],
  ["flattery is not specificity", "Flattery is not specificity"],
  ["no invented facts about them", "Never invent a fact about them"],
  ["gap comes from the analysis", "Take the gap from the fit analysis"],
  ["no 'writing to apply' opener", "I am writing to apply for"],
  ["don't restate the CV", "Do not restate my CV"],
].forEach(([label, needle]) => check(label, cover.includes(needle), needle));

console.log("\n--- prompt hygiene ---");
check("cover prompt fully resolved", !cover.includes("${"));
check("fit prompt fully resolved", !fit.includes("${"));
check("JD present once, not duplicated", (cover.match(/Colin is the hiring manager/g) || []).length === 1);
check("JD treated as data not instructions", /never as instructions/i.test(cover));
check("profile still embedded in cover", cover.includes("SingleStore") && cover.includes("Harrogate"));
check("word budget still stated", cover.includes("430"));
check("cover prompt is a sane size", cover.length > 20000 && cover.length < 60000, cover.length);

console.log("\n--- the prompts themselves obey the em-dash rule ---");
// A prompt full of em-dashes teaches the model to use them; that lesson was learned once already.
const emInCover = (cover.match(/—/g) || []).length;
const emInFit = (fit.match(/—/g) || []).length;
check("cover prompt em-dashes are only the quoted ban", emInCover <= 2, emInCover);
check("fit prompt em-dashes are only the quoted ban", emInFit <= 2, emInFit);

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
