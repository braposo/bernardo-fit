// Guards the "analysis is out of date" flag, and the regenerate that clears it.
//
// Two faults sit behind this. A row's description can be improved after it was
// analysed — a summary replaced with the real posting — and nothing about the
// row said so: the score looked current while answering a question about text
// that had been thrown away. And regenerate re-ran against the copy frozen in
// the report rather than what the row holds, so the obvious fix produced a
// fresh-looking analysis still built on the old text.
//
// The threshold matters as much as the comparison. Re-fetching the same posting
// a day later shifts it by a few characters, and four rows differed by
// twenty-six each. A flag that lights up for those is one you learn to ignore.

import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

process.env.ADMIN_SECRET = "test-secret-value";
const store = await import(base + "_store.js");
const jobsHandler = (await import(base + "admin/jobs.js")).default;

let pass = 0, fail = 0;
const check = (n, c, e) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 200) : "")); }
};
const { jdChange } = store;
const text = (n, seed) => (seed || "x").repeat(Math.ceil(n / (seed || "x").length)).slice(0, n);

console.log("\n--- identical text is never stale ---");
check("same string", !jdChange("abc".repeat(300), "abc".repeat(300)).stale);
check("whitespace and case do not count", !jdChange("The  ROLE\n\n", "the role").stale);
check("an empty side is not a change", !jdChange("", "abc").stale && !jdChange("abc", "").stale);
check("both empty", !jdChange("", "").stale);

console.log("\n--- trivial drift is not worth flagging ---");
// The real ones: re-fetching the same posting shifted these by 26 characters.
check("Aveni, 5,335 -> 5,361", !jdChange(text(5361), text(5335)).stale);
check("Primer, 5,560 -> 5,587", !jdChange(text(5587), text(5560)).stale);
check("Formula., 2,461 -> 2,484", !jdChange(text(2484), text(2461)).stale);
check("La Fosse, 2,708 -> 2,734", !jdChange(text(2734), text(2708)).stale);

console.log("\n--- a real change is ---");
check("Perk, 1,362 -> 6,180", jdChange(text(6180), text(1362)).stale);
check("CINC, 679 -> 7,343", jdChange(text(7343), text(679)).stale);
check("Ashby, 1,474 -> 15,600", jdChange(text(15600), text(1474)).stale);
check("M&S, 5,930 -> 6,679", jdChange(text(6679), text(5930)).stale);
// A description can lose its posting as easily as gain one, and that is just
// as wrong: the score then answers a fuller question than the row can show.
check("Griffin, 8,894 -> 812 (shrank)", jdChange(text(812), text(8894)).stale);
check("Flutter, 1,703 -> 365 (shrank)", jdChange(text(365), text(1703)).stale);

console.log("\n--- the two thresholds ---");
// Either a tenth of the text, or four hundred characters, whichever trips first.
check("a tenth of a short description counts", jdChange(text(1100), text(1000)).stale);
check("under a tenth of a short one does not", !jdChange(text(1050), text(1000)).stale);
check("400 characters counts however long the text", jdChange(text(20400), text(20000)).stale);
check("399 does not", !jdChange(text(20399), text(20000)).stale);

console.log("\n--- what the flag reports ---");
const c = jdChange(text(6180), text(1362));
check("it carries what was analysed", c.was === 1362, c);
check("and what is held now", c.now === 6180, c);

console.log("\n--- the listing says which rows are out of date ---");
function mockRes() {
  const r = { statusCode: 0, body: null };
  r.status = (s) => { r.statusCode = s; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r; r.setHeader = () => r;
  return r;
}
const list = async () => {
  const res = mockRes();
  await jobsHandler({ method: "GET", headers: { "x-admin-secret": "test-secret-value" }, query: {} }, res);
  return res.body.jobs;
};

const summary = text(1362, "summary ");
const posting = text(6180, "the full posting ");
const repId = await store.saveReport(
  { company: "Perk", job_title: "Engineering Manager", job_description: summary, created_at: "2026-08-17T00:00:00Z" },
  {}
);
// Analysed on the summary, then the real posting arrives.
const j = await store.saveJob({ company: "Perk", role: "Engineering Manager", jobDescription: posting, fitReportId: repId });
const other = await store.saveJob({ company: "Stora", role: "Engineering Manager", jobDescription: posting });

let rows = await list();
const byId = (id) => rows.find((r) => r.id === id);
check("the analysed row is flagged", byId(j.id).jd && byId(j.id).jd.stale === true, byId(j.id).jd);
check("it reports both sizes", byId(j.id).jd.was === 1362 && byId(j.id).jd.now === 6180, byId(j.id).jd);
check("a row with no analysis reports nothing", byId(other.id).jd === null, byId(other.id).jd);

console.log("\n--- regenerating reads the row, not the frozen copy ---");
// Without this the obvious fix is a trap: a fresh-looking analysis built on the
// text that was already wrong, and nothing on screen to say so.
const seen = [];
const analyze = await import(base + "_analyze.js");
const realRun = analyze.runAnalysis;
check("runAnalysis is what regenerate calls", typeof realRun === "function");

// Rather than stub the model, assert the endpoint hands over the row's text by
// reading the source: the call site is the whole fix.
const fs = await import("node:fs");
const src = fs.readFileSync(root + "api/admin/regenerate.js", "utf8");
check("it builds the jd from the owning row", /const jd = \(owner && \(owner\.jobDescription \|\| ""\)\.trim\(\)\) \|\| existing\.job_description;/.test(src));
check("it analyses that, not the report copy", /runAnalysis\(jd,/.test(src));
check("and writes it back so the flag clears", /report\.job_description = jd;/.test(src));
check("the old behaviour is gone", !/runAnalysis\(existing\.job_description/.test(src));

console.log("\n--- clearing the flag ---");
// What regenerate ends up doing: the report holds the row's text, so the next
// listing reads them as equal.
await store.overwriteReport(repId, {
  company: "Perk", job_title: "Engineering Manager", job_description: posting, created_at: "2026-08-17T00:00:00Z",
});
rows = await list();
check("the row is no longer flagged", byId(j.id) && !rows.find((r) => r.id === j.id).jd.stale, rows.find((r) => r.id === j.id).jd);

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
