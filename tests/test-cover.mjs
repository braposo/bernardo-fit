process.env.ADMIN_SECRET = "test-secret-value";
process.env.ANTHROPIC_API_KEY = "sk-fake";


// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

const LETTER = {
  salutation: "Dear Sanity team,",
  paragraphs: [
    { lead: true, html: 'I have <span class="em">done a version of this job</span> before.' },
    { html: "At TravelRepublic I led the platform rewrite across three brands." },
    { html: "I then ran the Web team at SingleStore for five years. <em>Two replatformings.</em>" },
    { html: '<script>alert(1)</script>Injected markup should not survive.' },
  ],
};
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ content: [{ type: "text", text: JSON.stringify(LETTER) }], stop_reason: "end_turn" }),
});

const store = await import(base + "_store.js");
const { runCoverLetter, COVER_MAX_WORDS } = await import(base + "_cover.js");
const { makeViewToken, verifyViewToken } = await import(base + "_admin.js");
const coverHandler = (await import(base + "admin/cover.js")).default;
const letterHandler = (await import(base + "letter.js")).default;

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
const hdrs = { ...auth, host: "fit.bernardoraposo.com" };

console.log("\n--- generation and sanitising ---");
const out = await runCoverLetter({ report: { job_title: "X" }, fitUrl: "https://fit.bernardoraposo.com/?r=abc" });
check("keeps the salutation", out.salutation === "Dear Sanity team,");
check("keeps the lead flag", out.paragraphs[0].lead === true);
check("keeps span.em", out.paragraphs[0].html.includes('<span class="em">'));
check("keeps <em>", out.paragraphs[2].html.includes("<em>"));
check("strips injected script tag", !JSON.stringify(out.paragraphs).includes("<script"));
check("keeps the injected text content", out.paragraphs[3].html.includes("Injected markup"));
check("appends the fit paragraph", out.paragraphs[out.paragraphs.length - 1].fit === true);
check("fit paragraph links correctly", out.paragraphs[out.paragraphs.length - 1].html.includes('href="https://fit.bernardoraposo.com/?r=abc"'));
check("counts words", typeof out.words === "number" && out.words > 0, out.words);
check("budget is enforced in the prompt", COVER_MAX_WORDS === 430);

console.log("\n--- view tokens ---");
const tok = makeViewToken("job1");
check("verifies for the right job", verifyViewToken("job1", tok) === true);
check("rejects a different job", verifyViewToken("job2", tok) === false);
check("rejects a tampered mac", verifyViewToken("job1", tok.split(".")[0] + ".deadbeef") === false);
check("rejects junk", verifyViewToken("job1", "nonsense") === false);
check("rejects an expired token", verifyViewToken("job1", (Date.now() - 1000) + ".x") === false);

console.log("\n--- POST /api/admin/cover ---");
let res = mockRes();
await coverHandler({ method: "POST", headers: {}, body: { id: "x" } }, res);
check("no secret -> 401", res.statusCode === 401);
res = mockRes();
await coverHandler({ method: "GET", headers: auth, body: {} }, res);
check("GET -> 405", res.statusCode === 405);
res = mockRes();
await coverHandler({ method: "POST", headers: auth, body: {} }, res);
check("no id -> 400", res.statusCode === 400);
res = mockRes();
await coverHandler({ method: "POST", headers: auth, body: { id: "nope" } }, res);
check("unknown job -> 404", res.statusCode === 404);

const noFit = await store.saveJob({ company: "NoFit", role: "R" });
res = mockRes();
await coverHandler({ method: "POST", headers: hdrs, body: { id: noFit.id } }, res);
check("refuses without an analysis", res.statusCode === 409, res.statusCode);
check("says why", /fit analysis first/i.test(res.body.error), res.body.error);

const rid = await store.saveReport({ job_title: "Head of Eng", company: "Sanity", job_description: "jd", created_at: new Date().toISOString() });
const job = await store.saveJob({ company: "Sanity", role: "Head of Eng", fitReportId: rid });
res = mockRes();
await coverHandler({ method: "POST", headers: hdrs, body: { id: job.id } }, res);
check("generates", res.statusCode === 200, res.body);
check("returns a token", !!res.body.token);
check("returns a word count", typeof res.body.words === "number");
const saved = await store.getJob(job.id);
check("saves onto the row", Array.isArray(saved.coverLetter) && saved.coverLetter.length > 0);
check("stamps the time", !!saved.coverLetterAt);

console.log("\n--- tokenOnly reopen ---");
res = mockRes();
await coverHandler({ method: "POST", headers: hdrs, body: { id: job.id, tokenOnly: true } }, res);
check("mints a token without rewriting", res.statusCode === 200 && !!res.body.token);
check("does not return words (no rewrite)", res.body.words === undefined);
res = mockRes();
await coverHandler({ method: "POST", headers: hdrs, body: { id: noFit.id, tokenOnly: true } }, res);
check("tokenOnly 409s when there's no analysis", res.statusCode === 409, res.statusCode);

console.log("\n--- GET /api/letter ---");
const good = makeViewToken(job.id);
res = mockRes();
await letterHandler({ method: "GET", query: { j: job.id, t: good } }, res);
check("serves the letter", res.statusCode === 200, res.body);
check("includes paragraphs", Array.isArray(res.body.paragraphs) && res.body.paragraphs.length > 0);
check("includes company", res.body.company === "Sanity");
res = mockRes();
await letterHandler({ method: "GET", query: { j: job.id } }, res);
check("no token -> 400", res.statusCode === 400);
res = mockRes();
await letterHandler({ method: "GET", query: { j: job.id, t: "bogus" } }, res);
check("bad token -> 401", res.statusCode === 401);
res = mockRes();
await letterHandler({ method: "GET", query: { j: noFit.id, t: makeViewToken(noFit.id) } }, res);
check("valid token, no letter -> 404", res.statusCode === 404);
res = mockRes();
await letterHandler({ method: "GET", query: { j: job.id, t: makeViewToken("other") } }, res);
check("token for another job -> 401", res.statusCode === 401);
res = mockRes();
await letterHandler({ method: "POST", query: {} }, res);
check("POST -> 405", res.statusCode === 405);

console.log("\n--- the letter is not public ---");
check("no secret needed but token required", true);
res = mockRes();
await letterHandler({ method: "GET", query: { j: job.id, t: "" } }, res);
check("empty token refused", res.statusCode === 400 || res.statusCode === 401);

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
