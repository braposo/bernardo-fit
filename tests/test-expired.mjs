process.env.ADMIN_SECRET = "test-secret-value";
process.env.ANTHROPIC_API_KEY = "sk-fake";
// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

import fs from "node:fs";

globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" }) });

const store = await import(base + "_store.js");
const jobsHandler = (await import(base + "admin/jobs.js")).default;

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

console.log("\n--- the stage exists ---");
check("expired is a stage", store.JOB_STAGES.includes("expired"));
check("the old stages are untouched", ["new","reviewing","applied","interviewing","offer","rejected","not_a_fit"].every((s) => store.JOB_STAGES.includes(s)));
check("it is terminal, at the end", store.JOB_STAGES[store.JOB_STAGES.length - 1] === "expired");
check("kept apart from rejected", store.JOB_STAGES.indexOf("expired") !== store.JOB_STAGES.indexOf("rejected"));

console.log("\n--- a row can be moved to it ---");
const job = await store.saveJob({ company: "Gone", role: "Withdrawn role" });
check("starts at new", job.stage === "new");
let res = mockRes();
await jobsHandler({ method: "PATCH", headers: auth, query: { id: job.id }, body: { stage: "expired" } }, res);
check("PATCH accepted", res.statusCode === 200, res.body);
check("row is expired", (await store.getJob(job.id)).stage === "expired");

console.log("\n--- and it survives a round trip ---");
await store.updateJob(job.id, { notes: "unrelated edit" });
check("stage sticks", (await store.getJob(job.id)).stage === "expired");
const saved = await store.saveJob({ company: "Gone2", role: "R", stage: "expired" });
check("can be set at save time", saved.stage === "expired");

console.log("\n--- rubbish is still rejected ---");
res = mockRes();
await jobsHandler({ method: "PATCH", headers: auth, query: { id: job.id }, body: { stage: "expiredish" } }, res);
check("unknown stage refused", res.statusCode === 400, res.body);
check("row unchanged", (await store.getJob(job.id)).stage === "expired");

console.log("\n--- the server tells the page about it ---");
res = mockRes();
await jobsHandler({ method: "GET", headers: auth, query: {} }, res);
check("stages list includes expired", (res.body.stages || []).includes("expired"), res.body.stages);

console.log("\n--- the page knows it too ---");
const html = fs.readFileSync(root + "public/admin.html", "utf8");
check("client fallback list has it", /var stages = \[[^\]]*"expired"\]/.test(html));
check("has a style rule", html.includes(".stage-expired {"));
check("no dead stage-closed rule", !html.includes(".stage-closed"));
check("renders as a readable label", html.includes('s.replace(/_/g, " ")'));

console.log("\n--- and the duplicated meta line is gone ---");
const dupes = (html.match(/meta\.push\("posting closed"\)/g) || []).length;
check("posting closed appears once", dupes === 1, dupes);

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
