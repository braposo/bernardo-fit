process.env.ADMIN_SECRET = "test-secret-value";
process.env.ANTHROPIC_API_KEY = "sk-fake";
// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

import fs from "node:fs";

let sentModels = [];
let variant = 1;
globalThis.fetch = async (_u, opts) => {
  const b = JSON.parse(opts.body);
  sentModels.push(b.model);
  return {
    ok: true,
    json: async () => ({
      content: [{ type: "text", text: JSON.stringify({
        job_title: "Role v" + variant, company: "C", pitch: "p", categories: [], differentiators: [], closing: "c",
        internal: { score: 50 + variant, tier: "Worth a look", breakdown: { location: 1, aiDx: 1, leadership: 1 }, reasoning: "r" + variant },
        salutation: "Dear team,", paragraphs: [{ lead: true, text: "Draft number " + variant + " with a few words in it." }],
      }) }],
      stop_reason: "end_turn",
    }),
  };
};

const store = await import(base + "_store.js");
const analyse = (await import(base + "admin/analyse.js")).default;
const regen = (await import(base + "admin/regenerate.js")).default;
const cover = (await import(base + "admin/cover.js")).default;
const versions = (await import(base + "admin/versions.js")).default;
const reportHandler = (await import(base + "report.js")).default;

let pass = 0, fail = 0;
const check = (n, c, e) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 200) : "")); }
};
function mockRes() {
  const r = { statusCode: 0, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r; r.setHeader = () => r;
  return r;
}
const auth = { "x-admin-secret": "test-secret-value", host: "fit.bernardoraposo.com" };
const call = async (h, req) => { const r = mockRes(); await h(req, r); return r; };

console.log("\n--- a first analysis creates version one ---");
const job = await store.saveJob({ company: "Acme", role: "R", jobDescription: "A long enough job description for a leadership role." });
variant = 1;
await call(analyse, { method: "POST", headers: auth, body: { id: job.id } });
const rid = (await store.getJob(job.id)).fitReportId;
let res = await call(versions, { method: "GET", headers: auth, query: { id: job.id } });
check("listed", res.statusCode === 200, res.body);
check("one fit version", res.body.fit.length === 1, res.body.fit);
check("it is live", res.body.fit[0].active === true);
check("model recorded", res.body.fit[0].model === "claude-opus-5", res.body.fit[0]);
check("score snapshotted", res.body.fit[0].score === 51, res.body.fit[0]);
check("no letter versions yet", res.body.letter.length === 0);

console.log("\n--- regenerating keeps the old one ---");
variant = 2;
await call(regen, { method: "POST", headers: auth, body: { id: rid, jobId: job.id } });
res = await call(versions, { method: "GET", headers: auth, query: { id: job.id } });
check("two versions now", res.body.fit.length === 2, res.body.fit);
check("newest first and live", res.body.fit[0].active === true && res.body.fit[1].active === false);
check("live report is the new one", (await store.getReport(rid)).job_title === "Role v2");
check("row scored from the new one", (await store.getJob(job.id)).score === 52);

console.log("\n--- switching back ---");
const olderVid = res.body.fit[1].vid;
res = await call(versions, { method: "POST", headers: auth, body: { id: job.id, kind: "fit", vid: olderVid } });
check("switch accepted", res.statusCode === 200, res.body);
check("live report reverted", (await store.getReport(rid)).job_title === "Role v1");
check("permalink unchanged", (await store.getJob(job.id)).fitReportId === rid);
check("score followed the version", (await store.getJob(job.id)).score === 51, (await store.getJob(job.id)).score);
res = await call(versions, { method: "GET", headers: auth, query: { id: job.id } });
check("active flag moved", res.body.fit.find((v) => v.vid === olderVid).active === true);
check("and only one is live", res.body.fit.filter((v) => v.active).length === 1);

console.log("\n--- the public page follows whatever is live ---");
res = await call(reportHandler, { method: "GET", query: { id: rid } });
check("public sees the chosen version", res.body.report.job_title === "Role v1", res.body.report.job_title);
check("and still no scoring", !("internal" in res.body.report));

console.log("\n--- cover letters keep their drafts ---");
variant = 3;
await call(cover, { method: "POST", headers: auth, body: { id: job.id } });
variant = 4;
await call(cover, { method: "POST", headers: auth, body: { id: job.id, model: "claude-sonnet-5" } });
res = await call(versions, { method: "GET", headers: auth, query: { id: job.id } });
check("two letter versions", res.body.letter.length === 2, res.body.letter);
check("newest is live", res.body.letter[0].active === true);
check("models differ", res.body.letter[0].model === "claude-sonnet-5" && res.body.letter[1].model === "claude-opus-5", res.body.letter.map((v) => v.model));
check("word counts recorded", res.body.letter.every((v) => v.words > 0));
const firstLetter = res.body.letter[1].vid;
res = await call(versions, { method: "POST", headers: auth, body: { id: job.id, kind: "letter", vid: firstLetter } });
check("letter switch accepted", res.statusCode === 200, res.body);
const after = await store.getJob(job.id);
check("live letter is the older draft", after.coverLetter[0].html.indexOf("Draft number 3") !== -1, after.coverLetter[0]);
check("live model followed it", after.coverLetterModel === "claude-opus-5");
check("only one letter is live", after.coverLetterVersions.filter((v) => v.active).length === 1);

console.log("\n--- listings stay small ---");
res = await call(versions, { method: "GET", headers: auth, query: { id: job.id } });
check("no report bodies in the listing", !JSON.stringify(res.body).includes("differentiators"));
check("no letter bodies in the listing", !JSON.stringify(res.body).includes("Draft number"));

console.log("\n--- errors ---");
check("unknown version", (await call(versions, { method: "POST", headers: auth, body: { id: job.id, kind: "fit", vid: "nope" } })).statusCode === 404);
check("bad kind", (await call(versions, { method: "POST", headers: auth, body: { id: job.id, kind: "banana", vid: "x" } })).statusCode === 400);
check("unknown job", (await call(versions, { method: "GET", headers: auth, query: { id: "nope" } })).statusCode === 404);
check("no secret", (await call(versions, { method: "GET", headers: {}, query: { id: job.id } })).statusCode === 401);
check("wrong method", (await call(versions, { method: "DELETE", headers: auth, query: { id: job.id } })).statusCode === 405);
const noFit = await store.saveJob({ company: "X", role: "R" });
check("no analysis yet", (await call(versions, { method: "POST", headers: auth, body: { id: noFit.id, kind: "fit", vid: "x" } })).statusCode === 409);

console.log("\n--- versions are capped ---");
const many = await store.saveJob({ company: "Many", role: "R", jobDescription: "Another long enough job description here." });
await call(analyse, { method: "POST", headers: auth, body: { id: many.id, model: "claude-sonnet-5" } });
const mrid = (await store.getJob(many.id)).fitReportId;
for (let i = 0; i < 14; i++) await call(regen, { method: "POST", headers: auth, body: { id: mrid, jobId: many.id } });
check("fit capped at 10", (await store.listReportVersions(mrid)).length === 10, (await store.listReportVersions(mrid)).length);
for (let i = 0; i < 12; i++) await call(cover, { method: "POST", headers: auth, body: { id: many.id } });
check("letters capped at 10", (await store.getJob(many.id)).coverLetterVersions.length === 10);

console.log("\n--- the page ---");
const html = fs.readFileSync(root + "public/admin.html", "utf8");
check("versions box present", html.includes("verbox"));
check("loads on open, not on list", html.includes('verBox.addEventListener("toggle"'));
check("has a use button", html.includes('data-act="veruse"'));
check("marks the live one", html.includes('class="vlive">live'));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
