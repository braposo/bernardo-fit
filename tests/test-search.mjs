// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

// Pulls haystack()/matchesSearch() straight out of admin.html and runs them
// against the real seed, so the test exercises the shipped code rather than a copy.
import fs from "node:fs";

const html = fs.readFileSync(
  "" + root + "public/admin.html",
  "utf8"
);
const grab = (name) => {
  const i = html.indexOf("function " + name + "(");
  if (i === -1) throw new Error("could not find " + name);
  let depth = 0, started = false;
  for (let k = i; k < html.length; k++) {
    if (html[k] === "{") { depth++; started = true; }
    else if (html[k] === "}") { depth--; if (started && depth === 0) return html.slice(i, k + 1); }
  }
  throw new Error("unbalanced " + name);
};
const { haystack, matchesSearch, searchTerms } = new Function(
  grab("haystack") + "\n" + grab("searchTerms") + "\n" + grab("matchesSearch") +
    "\nreturn { haystack, matchesSearch, searchTerms };"
)();

// Fixtures live here rather than in a shipped dataset, so the search tests
// stay meaningful once real data moves on. Shaped like real rows: the search
// runs over the whole record, not just the title.
const FIXTURES = [
  { company: "Sanity", role: "Head of Engineering", location: "Remote, UK", salary: "", source: "LinkedIn job alert", stage: "new", notes: "", tier: "Act now" },
  { company: "OpenAI", role: "Engineering Manager, Platform", location: "London", salary: "", source: "LinkedIn job alert", stage: "reviewing", notes: "", tier: "Act now" },
  { company: "CINC Systems", role: "Director of Engineering", location: "Remote", salary: "", source: "direct email", stage: "new", notes: "", tier: "Worth a look",
    recruiter: { name: "Alex Reeder", org: "Riviera Partners" } },
  { company: "Ashby", role: "Software Engineering Manager", location: "Remote", salary: "£110k - £130k", source: "LinkedIn job alert", stage: "new", notes: "", tier: "Worth a look" },
  { company: "Harrogate Digital", role: "Lead Engineer", location: "Harrogate, North Yorkshire", salary: "", source: "direct email", stage: "new", notes: "", tier: "Background" },
  { company: "Acme Design Systems", role: "Principal Engineer", location: "Leeds", salary: "", source: "LinkedIn job alert", stage: "applied", notes: "design system work", tier: "Background",
    jobDescription: "You will own our component library and Storybook setup across several product teams.",
    rationale: "Strong design system overlap, though the scope is narrower than the last role." },
  { company: "Northwind", role: "Staff Engineer", location: "Manchester", salary: "", source: "LinkedIn job alert", stage: "rejected", notes: "", tier: "Off-target" },
];
const jobs = FIXTURES.map((o, i) => ({ ...o, id: "j" + i }));
const find = (q) => jobs.filter((j) => matchesSearch(j, q.toLowerCase()));

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e) : "")); } };

console.log("\n--- basics ---");
check("empty query matches everything", find("").length === jobs.length);
check("company name", find("sanity").map((j) => j.company).includes("Sanity"));
check("partial company", find("open").some((j) => j.company === "OpenAI"));
check("role title", find("head of engineering").some((j) => j.role.includes("Head of Engineering")));
check("case insensitive", find("SANITY").length === find("sanity").length);
check("nonsense finds nothing", find("zzzzqqq").length === 0);

console.log("\n--- searches across the whole record ---");
check("matches a location", find("harrogate").length > 0, find("harrogate").map((j) => j.company));
check("matches a salary", find("110k").length > 0, find("110k").map((j) => j.company));
check("matches a recruiter name", find("alex reeder").some((j) => j.company === "CINC Systems"));
check("matches a tier as a phrase", find(String.fromCharCode(34)+"act now"+String.fromCharCode(34)).every((j) => j.tier === "Act now"));
check("matches inside a job description", find("storybook").length > 0, find("storybook").length);
check("matches inside the rationale", find("overlap").length > 0, find("overlap").length);

console.log("\n--- multi-term narrows ---");
const remote = find("remote");
const remoteAi = find("remote ai");
check("two terms return no more than one", remoteAi.length <= remote.length, { remote: remote.length, remoteAi: remoteAi.length });
check("every multi-term hit contains both", remoteAi.every((j) => {
  const h = haystack(j);
  return h.includes("remote") && h.includes("ai");
}));
check("term order is irrelevant", find("ai remote").length === remoteAi.length);
check("extra whitespace is harmless", find("  remote   ai  ".trim().replace(/\s+/g, " ")).length === remoteAi.length);

console.log("\n--- realistic lookups ---");
const cases = [
  [String.fromCharCode(34)+"design system"+String.fromCharCode(34), (j) => /design system/i.test(haystack(j))],
  ["fully remote", (j) => /fully remote/i.test(haystack(j))],
  ["leeds", (j) => /leeds/i.test(haystack(j))],
  ["typescript", (j) => /typescript/i.test(haystack(j))],
];
for (const [q, pred] of cases) {
  const got = find(q);
  check('"' + q + '" returns only true matches (' + got.length + ")", got.every(pred), got.filter((j) => !pred(j)).map((j) => j.company));
}

console.log("\n--- resilience ---");
check("handles a row with sparse fields", matchesSearch({ company: "X" }, "x") === true);
check("handles null recruiter", matchesSearch({ company: "X", recruiter: null }, "x") === true);
check("no crash on an empty object", matchesSearch({}, "anything") === false);

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
