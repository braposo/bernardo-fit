// Guards the admin UI against controls quietly disappearing.
//
// The other tests grep admin.html for strings, which proves a line exists and
// nothing about whether it renders. This one pulls the real render functions
// out of the page, runs them over job rows in each state, and asserts on the
// markup they actually produce. It also checks that every control rendered has
// a handler wired to it, which is the failure that looks identical to a missing
// button: it is on screen and does nothing.
//
// Written after the Draft answer button appeared to vanish. It had not; the
// label changes to "Draft again" once a question is answered. The same sweep
// found a word counter splitting on the letter "s" and an edit control that was
// invisible on any touch screen, neither of which any existing test could see.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";

const html = fs.readFileSync(root + "public/admin.html", "utf8");
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

let pass = 0, fail = 0;
const check = (n, c, e) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 200) : "")); }
};

// Lift a named function out of the page by matching its braces.
function grab(name) {
  const i = script.indexOf("function " + name + "(");
  if (i === -1) return null;
  let depth = 0;
  for (let k = script.indexOf("{", i); k < script.length; k++) {
    if (script[k] === "{") depth++;
    else if (script[k] === "}") { depth--; if (!depth) return script.slice(i, k + 1); }
  }
  return null;
}

const NEEDED = ["esc", "fmtDate", "fmtDateTime", "tierClass", "statsHtml", "versionsHtml", "versionRow", "questionsHtml", "countWords", "jobHtml"];
const missing = NEEDED.filter((n) => !grab(n));

console.log("\n--- the render functions are all still there ---");
check("no render function went missing", !missing.length, missing);
if (missing.length) { console.log("\npassed " + pass + ", failed " + fail); process.exit(1); }

const sandbox = [
  'var stages = ["new","reviewing","applied","interviewing","offer","rejected","not_a_fit","expired"];',
  'var MODELS = [{ id: "claude-opus-5", label: "Opus" }, { id: "claude-sonnet-5", label: "Sonnet" }];',
  'function modelLabel(id){ for (var i=0;i<MODELS.length;i++) if (MODELS[i].id===id) return MODELS[i].label; return ""; }',
  'var location = { origin: "https://fit.bernardoraposo.com" };',
  NEEDED.map(grab).join("\n"),
  "return { jobHtml: jobHtml, questionsHtml: questionsHtml, countWords: countWords };",
].join("\n");

let R;
try { R = new Function(sandbox)(); }
catch (err) { check("render functions evaluate", false, String(err)); console.log("\npassed " + pass + ", failed " + fail); process.exit(1); }
check("render functions evaluate", true);

const base = {
  id: "j1", role: "Engineering Manager", company: "DISCO", stage: "new", source: "LinkedIn job alert",
  jobDescription: "a".repeat(400), instructions: "", notes: "", archived: false,
  questions: [], coverLetterVersions: [], stats: null,
  score: 70, tier: "Worth a look", scoreBreakdown: { location: 1, aiDx: 1, leadership: 1 },
};
const row = (over) => R.jobHtml({ ...base, ...over });
const acts = (h) => [...h.matchAll(/data-act="([^"]+)"/g)].map((m) => m[1]);

console.log("\n--- every row offers its core controls ---");
const bare = acts(row({}));
for (const a of ["titleview", "titleform", "edittitle", "erole", "ecompany", "jd", "instructions", "notes", "stage", "qadd"]) {
  check("bare row has " + a, bare.includes(a), bare);
}

console.log("\n--- an analysed row gains the generation controls ---");
const analysed = acts(row({ fitReportId: "rep1" }));
for (const a of ["regen", "cover", "verbox"]) check("analysed row has " + a, analysed.includes(a), analysed);
// A row with nothing generated has nothing to version, so the box is absent
// by design rather than missing.
check("a bare row has no versions box", !bare.includes("verbox"));

console.log("\n--- a question always offers a way to answer it ---");
// The bug that prompted this file: the label changes once answered, so assert
// the control exists in both states rather than assuming one label.
const unanswered = row({ questions: [{ id: "q1", q: "Why here?", limit: 120, a: "", refused: false }] });
const answered = row({ questions: [{ id: "q1", q: "Why here?", limit: 120, a: "one two three", refused: false, answeredAt: "2026-08-21T00:00:00Z" }] });
const refused = row({ questions: [{ id: "q1", q: "Salary?", limit: 120, a: "", refused: true, reason: "no figure on file" }] });

check("unanswered question has a draft control", acts(unanswered).includes("qdraft"));
check("answered question still has one", acts(answered).includes("qdraft"));
check("refused question still has one", acts(refused).includes("qdraft"));
check("unanswered reads Draft answer", /Draft answer/.test(unanswered));
check("answered reads Draft again", /Draft again/.test(answered), answered.match(/>[^<]*Draft[^<]*</));
check("every question can be removed", acts(unanswered).includes("qdel"));
check("an answered question can be copied", acts(answered).includes("qcopy"));
check("an unanswered one cannot", !acts(unanswered).includes("qcopy"));
check("the question box opens itself when there are questions", /<details class="jdbox qabox" open>/.test(unanswered));

console.log("\n--- the word count is a word count ---");
check("counts words, not letters", R.countWords("one two three four") === 4, R.countWords("one two three four"));
check("splits on whitespace, not on the letter s", R.countWords("systems and services") === 3, R.countWords("systems and services"));
check("handles newlines and runs of space", R.countWords("a\n\nb   c") === 3);
check("empty is zero", R.countWords("") === 0 && R.countWords(null) === 0);
const long = new Array(130).fill("word").join(" ");
check("flags an answer over its limit", /qa-count over/.test(row({ questions: [{ id: "q1", q: "Q", limit: 120, a: long }] })));
check("does not flag one under it", !/qa-count over/.test(row({ questions: [{ id: "q1", q: "Q", limit: 120, a: "short answer" }] })));

console.log("\n--- an archived row swaps its actions rather than losing them ---");
const arch = acts(row({ archived: true, fitReportId: "rep1" }));
check("offers restore", arch.includes("restore"), arch);
check("offers delete", arch.includes("delete"), arch);
check("a live row offers archive instead", acts(row({ fitReportId: "rep1" })).includes("archive"));

console.log("\n--- every rendered control is wired to something ---");
// A control that renders but has no listener looks exactly like a missing one.
const rendered = new Set([].concat(bare, analysed, arch, acts(unanswered), acts(answered)));
const NOT_CLICKABLE = new Set(["titleview", "titleform", "erole", "ecompany", "qtext", "qlimit"]);
for (const a of [...rendered].sort()) {
  if (NOT_CLICKABLE.has(a)) continue;
  const wired = script.includes('[data-act="' + a + '"]');
  check(a + " has a handler", wired);
}

console.log("\n--- no control is revealed by hover alone ---");
// Touch screens have no hover, so a control that only appears on hover does not
// exist there. This is how the edit control was invisible on a phone.
const hidden = [...style.matchAll(/([.#][\w-]+)\s*\{[^}]*opacity:\s*0\s*;[^}]*\}/g)].map((m) => m[1]);
for (const sel of hidden) {
  const hasTouchFallback = new RegExp("@media \\(hover: none\\)[\\s\\S]*?\\" + sel).test(style);
  check(sel + " is reachable without hover", hasTouchFallback, sel);
}
check("checked at least the known one", style.includes(".titlepen"));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
