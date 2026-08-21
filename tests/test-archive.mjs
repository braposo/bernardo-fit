process.env.ADMIN_SECRET = "test-secret-value";
process.env.ANTHROPIC_API_KEY = "sk-fake";

// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ content: [{ type: "text", text: JSON.stringify({ job_title: "T", company: "C", pitch: "p", categories: [], differentiators: [], closing: "c" }) }], stop_reason: "end_turn" }),
});

const store = await import(base + "_store.js");
const jobsHandler = (await import(base + "admin/jobs.js")).default;
const reportHandler = (await import(base + "report.js")).default;
const analyseHandler = (await import(base + "admin/analyse.js")).default;

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

console.log("\n--- archiving removes a row from the pipeline ---");
const a = await store.saveJob({ externalId: "x1", company: "Acme", role: "EM", jobDescription: "A long enough job description to be analysed by the endpoint." });
const b = await store.saveJob({ externalId: "x2", company: "Beta", role: "VP" });
check("both in the pipeline", (await store.listJobs()).length === 2);
check("archived defaults false", a.archived === false);

let res = mockRes();
await analyseHandler({ method: "POST", headers: auth, body: { id: a.id } }, res);
const reportId = res.body.reportId;
check("row has a fit page", !!reportId);

res = mockRes();
await jobsHandler({ method: "PATCH", headers: auth, query: { id: a.id }, body: { archived: true } }, res);
check("PATCH archives", res.statusCode === 200 && res.body.job.archived === true, res.body);
check("archivedAt stamped", !!res.body.job.archivedAt);
check("gone from the pipeline", (await store.listJobs()).length === 1);
check("still exists in the store", (await store.getJob(a.id)) !== null);
check("countArchivedJobs sees it", (await store.countArchivedJobs()) === 1);
check("onlyArchived lists it", (await store.listJobs({ onlyArchived: true })).length === 1);
check("includeArchived lists both", (await store.listJobs({ includeArchived: true })).length === 2);

console.log("\n--- the fit page still resolves for a visitor ---");
res = mockRes();
await reportHandler({ method: "GET", query: { id: reportId } }, res);
check("report endpoint returns 200", res.statusCode === 200, res.statusCode);
check("report content intact", res.body.report && res.body.report.job_title === "T");

console.log("\n--- delete is gated behind archiving ---");
res = mockRes();
await jobsHandler({ method: "DELETE", headers: auth, query: { id: b.id } }, res);
check("DELETE refused while live", res.statusCode === 409, res.statusCode);
check("explains what to do instead", /archive/i.test(res.body.error), res.body.error);
check("row untouched", (await store.getJob(b.id)) !== null);

console.log("\n--- GET honours the archived view ---");
res = mockRes();
await jobsHandler({ method: "GET", headers: auth, query: {} }, res);
check("default view hides archived", res.body.jobs.length === 1, res.body.jobs.length);
check("reports archivedCount", res.body.archivedCount === 1, res.body.archivedCount);
check("viewingArchived false", res.body.viewingArchived === false);
res = mockRes();
await jobsHandler({ method: "GET", headers: auth, query: { archived: "1" } }, res);
check("archived view shows only archived", res.body.jobs.length === 1 && res.body.jobs[0].id === a.id);
check("viewingArchived true", res.body.viewingArchived === true);

console.log("\n--- restoring puts it back ---");
res = mockRes();
await jobsHandler({ method: "PATCH", headers: auth, query: { id: a.id }, body: { archived: false } }, res);
check("PATCH restores", res.body.job.archived === false);
check("archivedAt cleared", res.body.job.archivedAt === "", res.body.job.archivedAt);
check("back in the pipeline", (await store.listJobs()).length === 2);
check("stage and links intact", (await store.getJob(a.id)).fitReportId === reportId);

// Archiving is a decision, and the daily ingest must not undo it.
console.log("\n--- a re-ingest does not resurrect an archived row ---");
const ingest = (await import(base + "admin/ingest.js")).default;
const opp = { externalId: "arch-ing-1", company: "Seeded", role: "R", source: "direct email" };
res = mockRes();
await ingest({ method: "POST", headers: auth, body: { opportunities: [opp] } }, res);
const seeded = (await store.listJobs()).find((j) => j.externalId === "arch-ing-1");
await jobsHandler({ method: "PATCH", headers: auth, query: { id: seeded.id }, body: { archived: true, notes: "filed away" } }, mockRes());
res = mockRes();
await ingest({ method: "POST", headers: auth, body: { opportunities: [opp] } }, res);
const after = await store.getJob(seeded.id);
check("stays archived after a re-ingest", after.archived === true, after.archived);
check("its notes survive too", after.notes === "filed away", after.notes);
check("no duplicate created", (await store.listJobs({ includeArchived: true })).filter((j) => j.externalId === "arch-ing-1").length === 1);

console.log("\n--- bulk analyse skips archived rows ---");
const arch = await store.saveJob({ company: "Archived", role: "R", jobDescription: "A distinct long description that should not be analysed while archived.", archived: true });
res = mockRes();
await analyseHandler({ method: "POST", headers: auth, body: { all: true } }, res);
check("archived row left unanalysed", !(await store.getJob(arch.id)).fitReportId);

console.log("\n--- unlinked count ignores archived linkage correctly ---");
res = mockRes();
await jobsHandler({ method: "GET", headers: auth, query: {} }, res);
check("archived row's report not counted unlinked", typeof res.body.unlinked === "number");

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
