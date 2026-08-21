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
const jobs = (await import(base + "admin/jobs.js")).default;

let pass = 0, fail = 0;
const check = (n, c, e) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 160) : "")); }
};
function mockRes() {
  const r = { statusCode: 0, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r; r.setHeader = () => r;
  return r;
}
const auth = { "x-admin-secret": "test-secret-value", host: "fit.bernardoraposo.com" };
const patch = async (id, body) => { const r = mockRes(); await jobs({ method: "PATCH", headers: auth, query: { id }, body }, r); return r; };

console.log("\n--- a row with no company, as the scan sometimes leaves them ---");
const job = await store.saveJob({ externalId: "ext-1", role: "Engineering Manager", jobDescription: "A long enough job description here." });
check("no company to start", job.company === "");
let res = await patch(job.id, { company: "Acme Robotics" });
check("patch accepted", res.statusCode === 200, res.body);
check("company set", (await store.getJob(job.id)).company === "Acme Robotics");
check("role untouched", (await store.getJob(job.id)).role === "Engineering Manager");

console.log("\n--- and the role can be corrected too ---");
res = await patch(job.id, { role: "Head of Engineering", company: "Acme Robotics" });
check("both saved", res.statusCode === 200);
const after = await store.getJob(job.id);
check("role updated", after.role === "Head of Engineering");
check("company kept", after.company === "Acme Robotics");

console.log("\n--- clearing a company is allowed ---");
await patch(job.id, { company: "" });
check("cleared", (await store.getJob(job.id)).company === "");
await patch(job.id, { company: "Acme Robotics" });

console.log("\n--- renaming disturbs nothing else ---");
const withReport = await store.saveReport({ job_title: "T", company: "C", job_description: "A long enough job description here.", created_at: new Date().toISOString() });
await store.updateJob(job.id, { fitReportId: withReport, stage: "applied", notes: "keep me", instructions: "steer me" });
await patch(job.id, { company: "Renamed Ltd", role: "Director of Engineering" });
const r2 = await store.getJob(job.id);
check("fit report still linked", r2.fitReportId === withReport);
check("stage kept", r2.stage === "applied");
check("notes kept", r2.notes === "keep me");
check("instructions kept", r2.instructions === "steer me");
check("externalId kept, so import still matches", r2.externalId === "ext-1");
check("still in the pipeline", r2.archived === false);

console.log("\n--- an import does not undo the correction ---");
res = mockRes();
await jobs({ method: "POST", headers: auth, query: {}, body: { action: "import" } }, res);
const r3 = await store.getJob(job.id);
check("company survives an import run", r3.company === "Renamed Ltd", r3.company);
check("role survives an import run", r3.role === "Director of Engineering", r3.role);

console.log("\n--- the page ---");
const html = fs.readFileSync(root + "public/admin.html", "utf8");
check("edit button present", html.includes('data-act="edittitle"'));
check("both inputs present", html.includes('data-act="erole"') && html.includes('data-act="ecompany"'));
check("values escaped", html.includes('esc(j.role || "")') && html.includes('esc(j.company || "")'));
check("prompts when there is no company", html.includes("no company"));
check("saves on blur", html.includes('el.addEventListener("blur", saveTitle)'));
check("enter commits", html.includes('if (e.key === "Enter")'));
check("escape reverts", html.includes('if (e.key === "Escape")'));
check("does not save while moving between the two inputs", html.includes("titleForm.contains(document.activeElement)"));
// A display rule on .titleedit outranks the UA display:none behind the hidden
// attribute, so without this the inputs sit there permanently.
check("hidden beats the display rule", html.includes(".titleedit[hidden] { display: none; }"));
check("the view half hides too", html.includes(".row-title[hidden]"));
check("form starts hidden", html.includes(`data-act="titleform" hidden>`));

check("skips a no-op save", html.includes('if (role === (job.role || "") && company === (job.company || ""))'));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
