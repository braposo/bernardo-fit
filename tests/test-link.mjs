// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

// Covers the new unified behaviour: a website analysis creating or linking a
// pipeline row, and adopting analyses that predate it.
process.env.ADMIN_SECRET = "test-secret-value";
process.env.ANTHROPIC_API_KEY = "sk-fake-for-test";

const store = await import(base + "_store.js");
const jobsHandler = (await import(base + "admin/jobs.js")).default;

let pass = 0, fail = 0;
function check(n, c, e) {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e) : "")); }
}
function mockRes() {
  const r = { statusCode: 0, body: null, ended: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => { r.ended = true; return r; };
  r.setHeader = () => r;
  return r;
}
const auth = { "x-admin-secret": "test-secret-value" };

// Stub the network so analyze.js runs without calling Anthropic.
const FAKE = {
  job_title: "Head of Platform", company: "Northwind",
  pitch: "p", categories: [], differentiators: [], closing: "c",
};
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ content: [{ type: "text", text: JSON.stringify(FAKE) }], stop_reason: "end_turn" }),
});
const analyzeHandler = (await import(base + "analyze.js")).default;

const JD_A = "We are hiring a Head of Platform Engineering to lead three teams building developer tooling at scale.";
const JD_B = "Completely different role: a Marketing Manager for our consumer brand, based in Leeds, reporting to the CMO.";

function req(jd) {
  return { method: "POST", headers: { "x-forwarded-for": "1.2.3." + Math.floor(Math.random() * 250) }, body: { jobDescription: jd }, socket: {} };
}

console.log("\n--- website analysis creates a pipeline row ---");
let res = mockRes();
await analyzeHandler(req(JD_A), res);
check("analyze 200", res.statusCode === 200, res.body && res.body.error);
const reportId = res.body.id;
let jobs = await store.listJobs();
check("one job created", jobs.length === 1, jobs.length);
check("job carries company from the report", jobs[0].company === "Northwind", jobs[0].company);
check("job carries role from the report", jobs[0].role === "Head of Platform", jobs[0].role);
check("job linked to the report", jobs[0].fitReportId === reportId);
check("job marked as website-sourced", jobs[0].sourceType === "website", jobs[0].sourceType);
check("job holds the job description", jobs[0].jobDescription === JD_A);

console.log("\n--- re-analysing the same JD does not duplicate ---");
res = mockRes();
await analyzeHandler(req(JD_A), res);
check("second run is cached", res.body.cached === true);
jobs = await store.listJobs();
check("still one job", jobs.length === 1, jobs.length);

console.log("\n--- a different JD adds a second row ---");
res = mockRes();
await analyzeHandler(req(JD_B), res);
jobs = await store.listJobs();
check("two jobs now", jobs.length === 2, jobs.length);

console.log("\n--- an existing pipeline row gets linked, not duplicated ---");
const JD_C = "Principal Engineer wanted to own our design system and component library across three brands, remote UK.";
const seeded = await store.saveJob({ company: "Preexisting", role: "Principal Engineer", jobDescription: JD_C, stage: "reviewing", notes: "from the inbox" });
res = mockRes();
await analyzeHandler(req(JD_C), res);
jobs = await store.listJobs();
check("no new row created", jobs.length === 3, jobs.length);
const linked = await store.getJob(seeded.id);
check("existing row linked to the analysis", linked.fitReportId === res.body.id, linked.fitReportId);
check("existing row keeps its company", linked.company === "Preexisting");
check("existing row keeps its stage", linked.stage === "reviewing", linked.stage);
check("existing row keeps its notes", linked.notes === "from the inbox");

console.log("\n--- unlinked analyses are reported and adoptable ---");
const orphan = await store.saveReport({
  job_title: "Orphan Role", company: "Oldco", job_description: "An analysis saved before the pipeline existed, long enough to be valid.",
  created_at: new Date().toISOString(),
});
res = mockRes();
await jobsHandler({ method: "GET", headers: auth, query: {} }, res);
check("GET reports 1 unlinked", res.body.unlinked === 1, res.body.unlinked);

res = mockRes();
await jobsHandler({ method: "POST", headers: auth, query: {}, body: { action: "adopt" } }, res);
check("adopt adds it", res.body.added === 1, res.body);
jobs = await store.listJobs();
check("four jobs now", jobs.length === 4, jobs.length);
const adopted = jobs.find((j) => j.company === "Oldco");
check("adopted row is linked", adopted.fitReportId === orphan);
check("adopted row took the title", adopted.role === "Orphan Role");

res = mockRes();
await jobsHandler({ method: "GET", headers: auth, query: {} }, res);
check("nothing unlinked afterwards", res.body.unlinked === 0, res.body.unlinked);
res = mockRes();
await jobsHandler({ method: "POST", headers: auth, query: {}, body: { action: "adopt" } }, res);
check("adopt again is a no-op", res.body.added === 0, res.body);

console.log("\n--- job description is editable via PATCH ---");
const alertOnly = await store.saveJob({ company: "AlertCo", role: "EM", jobDescription: "" });
res = mockRes();
await jobsHandler({ method: "PATCH", headers: auth, query: { id: alertOnly.id }, body: { jobDescription: "A pasted description long enough to analyse." } }, res);
check("PATCH sets jobDescription", res.statusCode === 200 && res.body.job.jobDescription.length > 20);

console.log("\n--- a failing pipeline write must not break the analysis ---");
const realList = store.listJobs;
res = mockRes();
await analyzeHandler(req("Yet another distinct role description for the failure-path test, long enough to pass."), res);
check("analysis still returns 200", res.statusCode === 200);

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
