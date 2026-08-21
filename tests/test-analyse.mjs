process.env.ADMIN_SECRET = "test-secret-value";
process.env.ANTHROPIC_API_KEY = "sk-fake";

// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

let apiCalls = 0;
globalThis.fetch = async () => {
  apiCalls++;
  return {
    ok: true,
    json: async () => ({
      content: [{ type: "text", text: JSON.stringify({ job_title: "T", company: "C", pitch: "p", categories: [], differentiators: [], closing: "c" }) }],
      stop_reason: "end_turn",
    }),
  };
};

const store = await import(base + "_store.js");
const analyseHandler = (await import(base + "admin/analyse.js")).default;
const jobsHandler = (await import(base + "admin/jobs.js")).default;

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

console.log("\n--- analyse endpoint: auth and methods ---");
let res = mockRes();
await analyseHandler({ method: "POST", headers: {}, body: {} }, res);
check("no secret -> 401", res.statusCode === 401);
res = mockRes();
await analyseHandler({ method: "GET", headers: auth, body: {} }, res);
check("GET -> 405", res.statusCode === 405);
res = mockRes();
await analyseHandler({ method: "POST", headers: auth, body: {} }, res);
check("no id and no all -> 400", res.statusCode === 400);
res = mockRes();
await analyseHandler({ method: "POST", headers: auth, body: { id: "nope" } }, res);
check("unknown id -> 404", res.statusCode === 404);

console.log("\n--- analyse a single row ---");
const jobA = await store.saveJob({ company: "A", role: "R", jobDescription: "A sufficiently long job description for the analyser to accept it happily." });
apiCalls = 0;
res = mockRes();
await analyseHandler({ method: "POST", headers: auth, body: { id: jobA.id } }, res);
check("returns 200", res.statusCode === 200, res.body);
check("made one API call", apiCalls === 1, apiCalls);
check("row now linked", (await store.getJob(jobA.id)).fitReportId === res.body.reportId);

console.log("\n--- dedup: same JD costs nothing ---");
const jobB = await store.saveJob({ company: "B", role: "R2", jobDescription: "A sufficiently long job description for the analyser to accept it happily." });
apiCalls = 0;
res = mockRes();
await analyseHandler({ method: "POST", headers: auth, body: { id: jobB.id } }, res);
check("reported as cached", res.body.cached === true, res.body);
check("made no API call", apiCalls === 0, apiCalls);
check("linked to the same report", (await store.getJob(jobB.id)).fitReportId === (await store.getJob(jobA.id)).fitReportId);

console.log("\n--- a row with no description is refused ---");
const jobC = await store.saveJob({ company: "C", role: "R3", jobDescription: "" });
res = mockRes();
await analyseHandler({ method: "POST", headers: auth, body: { id: jobC.id } }, res);
check("400 with a useful message", res.statusCode === 400 && /fuller/i.test(res.body.error), res.body);

console.log("\n--- bulk: analyse all ---");
// Import the real seed so the bulk run has realistic volume.
res = mockRes();
await jobsHandler({ method: "POST", headers: auth, body: { action: "import" }, query: {} }, res);
const pending = (await store.listJobs()).filter((j) => !j.fitReportId && (j.jobDescription || "").trim().length >= 20);
apiCalls = 0;
res = mockRes();
await analyseHandler({ method: "POST", headers: auth, body: { all: true } }, res);
check("reports the pending count", res.body.pending === pending.length, { got: res.body.pending, want: pending.length });
check("analysed them all", res.body.analysed === pending.length, res.body);
check("no failures", res.body.failed === 0, res.body);
check("one API call per distinct JD", apiCalls <= pending.length, { apiCalls, pending: pending.length });
const stillPending = (await store.listJobs()).filter((j) => !j.fitReportId && (j.jobDescription || "").trim().length >= 20);
check("nothing left pending", stillPending.length === 0, stillPending.length);

console.log("\n--- bulk is idempotent ---");
apiCalls = 0;
res = mockRes();
await analyseHandler({ method: "POST", headers: auth, body: { all: true } }, res);
check("second run finds nothing", res.body.pending === 0, res.body);
check("second run makes no API calls", apiCalls === 0, apiCalls);

console.log("\n--- rows without a description are left alone ---");
const noJd = (await store.listJobs()).filter((j) => !(j.jobDescription || "").trim());
check("off-target rows still unanalysed", noJd.every((j) => !j.fitReportId), noJd.filter((j) => j.fitReportId).length);

console.log("\n--- one failure does not abort the batch ---");
await store.saveJob({ company: "Boom", role: "X", jobDescription: "This description is long enough to be analysed but the call will fail." });
await store.saveJob({ company: "Fine", role: "Y", jobDescription: "Another distinct description that is long enough to be analysed properly." });
let n = 0;
globalThis.fetch = async () => {
  n++;
  if (n === 1) throw new Error("network down");
  return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ job_title: "T", company: "C", pitch: "p", categories: [], differentiators: [], closing: "c" }) }], stop_reason: "end_turn" }) };
};
res = mockRes();
await analyseHandler({ method: "POST", headers: auth, body: { all: true } }, res);
check("batch still returns 200", res.statusCode === 200, res.statusCode);
check("one failure recorded", res.body.failed === 1, res.body);
check("the other still analysed", res.body.analysed === 1, res.body);

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
