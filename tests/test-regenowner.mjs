process.env.ADMIN_SECRET = "test-secret-value";
process.env.ANTHROPIC_API_KEY = "sk-fake";


// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

let sentPrompts = [];
globalThis.fetch = async (_url, opts) => {
  sentPrompts.push(JSON.parse(opts.body).system);
  return {
    ok: true,
    json: async () => ({
      content: [{ type: "text", text: JSON.stringify({
        job_title: "T", company: "C", pitch: "p", categories: [], differentiators: [], closing: "c",
        internal: { score: 81, tier: "Act now", breakdown: { location: 1, aiDx: 2, leadership: 3 }, reasoning: "r" },
      }) }],
      stop_reason: "end_turn",
    }),
  };
};

const store = await import(base + "_store.js");
const regen = (await import(base + "admin/regenerate.js")).default;

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 160) : "")); } };
function mockRes() {
  const r = { statusCode: 0, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r; r.setHeader = () => r;
  return r;
}
const auth = { "x-admin-secret": "test-secret-value", host: "fit.bernardoraposo.com" };

// Dedup collapses two postings of the same role onto one report. This is the
// real case: the same job listed by the company and by an agency.
const STEER = "Mention the platform migration. Their CTO raised it on the call.";
const JD = "Head of Platform Engineering, remote, leading three squads on a content platform.";

const reportId = await store.saveReport({ job_title: "T", company: "C", job_description: JD, created_at: new Date().toISOString() });
const bare = await store.saveJob({ company: "Direct", role: "R", jobDescription: JD, fitReportId: reportId });
const steered = await store.saveJob({ company: "Agency", role: "R", jobDescription: JD, fitReportId: reportId, instructions: STEER });

console.log("\n--- two rows, one report ---");
check("both point at the same report", (await store.getJob(bare.id)).fitReportId === (await store.getJob(steered.id)).fitReportId);

console.log("\n--- regenerate from the steered row ---");
sentPrompts = [];
let res = mockRes();
await regen({ method: "POST", headers: auth, body: { id: reportId, jobId: steered.id } }, res);
check("regenerated", res.statusCode === 200, res.body);
check("used that row's instructions", sentPrompts[0].includes(STEER));

console.log("\n--- regenerate from the bare row ---");
sentPrompts = [];
res = mockRes();
await regen({ method: "POST", headers: auth, body: { id: reportId, jobId: bare.id } }, res);
check("honours the row that asked", !sentPrompts[0].includes(STEER));

console.log("\n--- regenerate with no row named ---");
sentPrompts = [];
res = mockRes();
await regen({ method: "POST", headers: auth, body: { id: reportId } }, res);
check("falls back to the row that has instructions", sentPrompts[0].includes(STEER));

console.log("\n--- rescoring reaches every row sharing the report ---");
check("steered row scored", (await store.getJob(steered.id)).score === 81);
check("bare row scored too", (await store.getJob(bare.id)).score === 81, await store.getJob(bare.id));

console.log("\n--- a report nobody owns still regenerates ---");
const orphan = await store.saveReport({ job_title: "T", company: "C", job_description: JD, created_at: new Date().toISOString() });
sentPrompts = [];
res = mockRes();
await regen({ method: "POST", headers: auth, body: { id: orphan } }, res);
check("no crash without an owner", res.statusCode === 200, res.body);
check("and no instructions leak in", !sentPrompts[0].includes(STEER));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
