process.env.ADMIN_SECRET = "test-secret-value";
process.env.ANTHROPIC_API_KEY = "sk-fake";


// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

// The model returns the private block inline; everything downstream must strip it.
const MODEL_OUTPUT = {
  job_title: "Head of Platform", company: "Northwind",
  pitch: "p", categories: [{ name: "Technical fit", note: "n" }],
  differentiators: [{ headline: "h", detail: "d" }], closing: "c",
  internal: {
    score: 91, tier: "Act now",
    breakdown: { location: 100, aiDx: 95, leadership: 75 },
    reasoning: "Remote and AI-heavy. Worth chasing.",
  },
};
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ content: [{ type: "text", text: JSON.stringify(MODEL_OUTPUT) }], stop_reason: "end_turn" }),
});

const store = await import(base + "_store.js");
const { splitInternal, stripInternal } = await import(base + "_analyze.js");
const analyzeHandler = (await import(base + "analyze.js")).default;
const reportHandler = (await import(base + "report.js")).default;
const adminAnalyse = (await import(base + "admin/analyse.js")).default;
const regenerate = (await import(base + "admin/regenerate.js")).default;
const jobsHandler = (await import(base + "admin/jobs.js")).default;
const ingestHandler = (await import(base + "admin/ingest.js")).default;

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e) : "")); } };
function mockRes() {
  const r = { statusCode: 0, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r; r.setHeader = () => r;
  return r;
}
const auth = { "x-admin-secret": "test-secret-value" };
const ip = () => ({ "x-forwarded-for": "9.9.9." + Math.floor(Math.random() * 250) });

console.log("\n--- splitInternal ---");
const split = splitInternal(JSON.parse(JSON.stringify(MODEL_OUTPUT)));
check("report has no internal key", !("internal" in split.report));
check("public fields survive", split.report.job_title === "Head of Platform");
check("score extracted", split.internal.score === 91);
check("tier extracted", split.internal.tier === "Act now");
check("breakdown extracted", split.internal.breakdown.aiDx === 95);
check("reasoning extracted", /Worth chasing/.test(split.internal.reasoning));
check("handles a missing block", splitInternal({ job_title: "x" }).internal === null);
check("clamps a silly score", splitInternal({ internal: { score: 999 } }).internal.score === 100);
check("rejects a non-numeric score", splitInternal({ internal: { score: "high" } }).internal.score === null);
check("stripInternal removes it", !("internal" in stripInternal({ a: 1, internal: { score: 5 } })));
check("stripInternal tolerates junk", stripInternal(null) === null);

console.log("\n--- public analyse never persists or returns a score ---");
let res = mockRes();
await analyzeHandler({ method: "POST", headers: ip(), socket: {}, body: { jobDescription: "A long enough job description about a remote platform leadership role." } }, res);
check("returns 200", res.statusCode === 200, res.body && res.body.error);
const rid = res.body.id;
check("response body carries no internal", !("internal" in res.body.report));
check("no score field leaked", !JSON.stringify(res.body).includes("91"));
const saved = await store.getReport(rid);
check("saved report has no internal", !("internal" in saved));

console.log("\n--- the score landed on the pipeline row instead ---");
let row = (await store.listJobs()).find((j) => j.fitReportId === rid);
check("row exists", !!row);
check("row carries the score", row.score === 91, row.score);
check("row carries the tier", row.tier === "Act now");
check("row carries the breakdown", row.scoreBreakdown && row.scoreBreakdown.location === 100);
check("row carries the reasoning", /Worth chasing/.test(row.rationale));

console.log("\n--- /api/report is clean, including for a poisoned old report ---");
res = mockRes();
await reportHandler({ method: "GET", query: { id: rid } }, res);
check("report endpoint 200", res.statusCode === 200);
check("no internal in the response", !("internal" in res.body.report));
// Simulate a report saved by an older build that kept the block inline.
await store.overwriteReport(rid, { ...saved, internal: { score: 77 } });
res = mockRes();
await reportHandler({ method: "GET", query: { id: rid } }, res);
check("legacy inline block stripped on read", !("internal" in res.body.report));
// A raw substring scan is wrong here: "77" turns up by chance in generated
// ids and timestamps. Assert on the shape instead.
const leaked = JSON.stringify(res.body).match(/"(score|tier|breakdown|reasoning|internal)"/g);
check("no scoring fields anywhere in the payload", !leaked, leaked);

console.log("\n--- admin analyse scores the row ---");
const j2 = await store.saveJob({ company: "Solo", role: "R", jobDescription: "A distinct description long enough to be analysed on its own merits." });
res = mockRes();
await adminAnalyse({ method: "POST", headers: auth, body: { id: j2.id } }, res);
check("returns scored", res.body.scored === true, res.body);
const j2after = await store.getJob(j2.id);
check("row scored", j2after.score === 91, j2after.score);
check("its report is clean", !("internal" in (await store.getReport(j2after.fitReportId))));

console.log("\n--- regenerate rescores the owning row ---");
await store.updateJob(j2.id, { score: 10, tier: "Off-target" });
res = mockRes();
await regenerate({ method: "POST", headers: auth, body: { id: j2after.fitReportId } }, res);
check("reports rescored", res.body.rescored === true, res.body);
check("row score refreshed", (await store.getJob(j2.id)).score === 91);
check("regenerated report still clean", !("internal" in res.body.report));

console.log("\n--- delete only after archiving ---");
const j3 = await store.saveJob({ company: "Temp", role: "R" });
res = mockRes();
await jobsHandler({ method: "DELETE", headers: auth, query: { id: j3.id } }, res);
check("delete blocked while live", res.statusCode === 409, res.statusCode);
check("explains why", /archive/i.test(res.body.error), res.body.error);
check("row still there", (await store.getJob(j3.id)) !== null);
await jobsHandler({ method: "PATCH", headers: auth, query: { id: j3.id }, body: { archived: true } }, mockRes());
res = mockRes();
await jobsHandler({ method: "DELETE", headers: auth, query: { id: j3.id } }, res);
check("delete allowed once archived", res.statusCode === 200, res.statusCode);
check("row gone", (await store.getJob(j3.id)) === null);
res = mockRes();
await jobsHandler({ method: "DELETE", headers: auth, query: { id: j3.id } }, res);
check("deleting twice -> 404", res.statusCode === 404);

console.log("\n--- deleting a row leaves its fit page alive ---");
const j4 = await store.saveJob({ company: "Shared", role: "R", jobDescription: "Another distinct description that will be analysed then the row removed." });
await adminAnalyse({ method: "POST", headers: auth, body: { id: j4.id } }, mockRes());
const keptReportId = (await store.getJob(j4.id)).fitReportId;
await jobsHandler({ method: "PATCH", headers: auth, query: { id: j4.id }, body: { archived: true } }, mockRes());
await jobsHandler({ method: "DELETE", headers: auth, query: { id: j4.id } }, mockRes());
res = mockRes();
await reportHandler({ method: "GET", query: { id: keptReportId } }, res);
check("shared link still resolves after delete", res.statusCode === 200, res.statusCode);

console.log("\n--- ingest endpoint ---");
res = mockRes();
await ingestHandler({ method: "POST", headers: {}, body: {} }, res);
check("no secret -> 401", res.statusCode === 401);
res = mockRes();
await ingestHandler({ method: "GET", headers: auth, body: {} }, res);
check("GET -> 405", res.statusCode === 405);
res = mockRes();
await ingestHandler({ method: "POST", headers: auth, body: { opportunities: "nope" } }, res);
check("non-array -> 400", res.statusCode === 400);

res = mockRes();
await ingestHandler({ method: "POST", headers: auth, body: { opportunities: [
  { externalId: "ing-1", company: "NewCo", role: "Head of Eng", sourceUrl: "https://x", receivedAt: "2026-08-18T09:00:00Z" },
  { externalId: "ing-2", company: "Other", role: "EM" },
  { company: "NoKey", role: "Nope" },
  { externalId: "ing-3" },
  "garbage",
] } }, res);
check("added the two valid rows", res.body.added === 2, res.body);
check("skipped the invalid ones", res.body.skipped === 3, res.body);
check("returns what it added", res.body.addedRows.length === 2 && res.body.addedRows[0].company === "NewCo");
check("new rows arrive unscored", (await store.listJobs()).find((j) => j.externalId === "ing-1").score === null);

console.log("\n--- ingest is an upsert that respects your edits ---");
const ing1 = (await store.listJobs()).find((j) => j.externalId === "ing-1");
await store.updateJob(ing1.id, { stage: "applied", notes: "mine", score: 88, tier: "Act now" });
res = mockRes();
await ingestHandler({ method: "POST", headers: auth, body: { opportunities: [
  { externalId: "ing-1", company: "NewCo Renamed", role: "Head of Eng", jobDescription: "" },
] } }, res);
const ing1b = await store.getJob(ing1.id);
check("counted as updated", res.body.updated === 1, res.body);
check("scan field refreshed", ing1b.company === "NewCo Renamed");
check("stage preserved", ing1b.stage === "applied");
check("notes preserved", ing1b.notes === "mine");
check("score preserved", ing1b.score === 88, ing1b.score);
check("no duplicate row", (await store.listJobs()).filter((j) => j.externalId === "ing-1").length === 1);

console.log("\n--- ingest will not resurrect an archived row ---");
await store.updateJob(ing1.id, { archived: true });
res = mockRes();
await ingestHandler({ method: "POST", headers: auth, body: { opportunities: [{ externalId: "ing-1", company: "NewCo", role: "Head of Eng" }] } }, res);
check("still archived", (await store.getJob(ing1.id)).archived === true);

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
