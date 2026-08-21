process.env.ADMIN_SECRET = "test-secret-value";
process.env.ANTHROPIC_API_KEY = "sk-fake";


// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

// Capture every system prompt sent, so we can assert what the model actually saw.
let sentPrompts = [];
let calls = 0;
globalThis.fetch = async (_url, opts) => {
  calls++;
  sentPrompts.push(JSON.parse(opts.body).system);
  return {
    ok: true,
    json: async () => ({
      content: [{ type: "text", text: JSON.stringify({
        job_title: "T", company: "C", pitch: "p", categories: [], differentiators: [], closing: "c",
        internal: { score: 70, tier: "Worth a look", breakdown: { location: 1, aiDx: 2, leadership: 3 }, reasoning: "r" },
        salutation: "Dear team,", paragraphs: [{ lead: true, text: "A first paragraph with plenty of words in it." }],
      }) }],
      stop_reason: "end_turn",
    }),
  };
};

const store = await import(base + "_store.js");
const { buildSystemPrompt } = await import(base + "_profile.js");
const { buildCoverPrompt } = await import(base + "_cover.js");
const analyseHandler = (await import(base + "admin/analyse.js")).default;
const coverHandler = (await import(base + "admin/cover.js")).default;
const regenHandler = (await import(base + "admin/regenerate.js")).default;
const reportHandler = (await import(base + "report.js")).default;

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e) : "")); } };
function mockRes() {
  const r = { statusCode: 0, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r; r.setHeader = () => r;
  return r;
}
const auth = { "x-admin-secret": "test-secret-value", host: "fit.bernardoraposo.com" };
const reset = () => { sentPrompts = []; calls = 0; };

const STEER = "Lead on the Solana and payments work. They raised crypto rails on the call.";
const JD = "A long enough job description about a platform engineering leadership role in London.";

console.log("\n--- prompts carry instructions only when set ---");
check("fit omits the block when empty", !buildSystemPrompt().includes("My instructions for this specific role"));
check("fit includes it when set", buildSystemPrompt({ instructions: STEER }).includes(STEER));
check("whitespace counts as empty", !buildSystemPrompt({ instructions: "  \n " }).includes("My instructions"));
check("cover includes it when set", buildCoverPrompt({ report: { job_description: "x" }, fitUrl: "https://x", instructions: STEER }).includes(STEER));
check("limits are stated", buildSystemPrompt({ instructions: STEER }).includes("cannot override the structural rules"));
check("framed as trusted instruction", buildSystemPrompt({ instructions: STEER }).includes("treat them as instructions and follow them"));

console.log("\n--- analysis picks them up ---");
const plain = await store.saveJob({ company: "Plain", role: "R", jobDescription: JD });
reset();
let res = mockRes();
await analyseHandler({ method: "POST", headers: auth, body: { id: plain.id } }, res);
check("analyses without instructions", res.statusCode === 200);
check("prompt had no instruction block", !sentPrompts[0].includes("My instructions for this specific role"));

const steered = await store.saveJob({ company: "Steered", role: "R", jobDescription: JD, instructions: STEER });
reset();
res = mockRes();
await analyseHandler({ method: "POST", headers: auth, body: { id: steered.id } }, res);
check("analyses with instructions", res.statusCode === 200, res.body);
check("prompt carried them", sentPrompts[0].includes(STEER));

console.log("\n--- the dedup trap: same JD, different steer ---");
check("did NOT reuse the cached report", res.body.cached !== true, res.body);
check("made a real API call", calls === 1, calls);
const a = await store.getJob(plain.id), b = await store.getJob(steered.id);
check("two distinct reports exist", a.fitReportId !== b.fitReportId, { a: a.fitReportId, b: b.fitReportId });

// and confirm dedup still works when there is no steer
const twin = await store.saveJob({ company: "Twin", role: "R", jobDescription: JD });
reset();
res = mockRes();
await analyseHandler({ method: "POST", headers: auth, body: { id: twin.id } }, res);
check("unsteered duplicate still dedupes", res.body.cached === true, res.body);
check("and cost nothing", calls === 0, calls);

console.log("\n--- cover letter picks them up ---");
reset();
res = mockRes();
await coverHandler({ method: "POST", headers: auth, body: { id: steered.id } }, res);
check("letter generated", res.statusCode === 200, res.body);
check("cover prompt carried them", sentPrompts.some((p) => p.includes(STEER)));
reset();
res = mockRes();
await coverHandler({ method: "POST", headers: auth, body: { id: plain.id } }, res);
check("unsteered letter has no block", !sentPrompts[0].includes("My instructions for this specific role"));

console.log("\n--- regenerate picks them up ---");
reset();
res = mockRes();
await regenHandler({ method: "POST", headers: auth, body: { id: (await store.getJob(steered.id)).fitReportId } }, res);
check("regenerated", res.statusCode === 200, res.body);
check("regenerate carried them", sentPrompts[0].includes(STEER));
check("row rescored", (await store.getJob(steered.id)).score === 70);

console.log("\n--- editing instructions then regenerating changes the result ---");
await store.updateJob(steered.id, { instructions: "Completely different steer about design systems." });
reset();
res = mockRes();
await regenHandler({ method: "POST", headers: auth, body: { id: (await store.getJob(steered.id)).fitReportId } }, res);
check("new steer reached the model", sentPrompts[0].includes("design systems"));
// "Solana" appears throughout the profile, so assert on a phrase unique to the old steer.
check("old steer is gone", !sentPrompts[0].includes("crypto rails on the call"));

console.log("\n--- instructions stay private ---");
const rid = (await store.getJob(steered.id)).fitReportId;
res = mockRes();
await reportHandler({ method: "GET", query: { id: rid } }, res);
check("public report has no instructions", !JSON.stringify(res.body).includes("design systems"), Object.keys(res.body.report));
check("public report has no internal block", !("internal" in res.body.report));

console.log("\n--- persistence ---");
check("saved on the row", (await store.getJob(steered.id)).instructions.includes("design systems"));
check("survives an unrelated patch", await (async () => {
  await store.updateJob(steered.id, { stage: "applied" });
  return (await store.getJob(steered.id)).instructions.includes("design systems");
})());
check("defaults to empty string", (await store.saveJob({ company: "Bare", role: "R" })).instructions === "");

console.log("\n--- inbox import does not clobber them ---");
const jobsHandler = (await import(base + "admin/jobs.js")).default;
const seeded = await store.saveJob({ externalId: "ins-test", company: "Seeded", role: "R", instructions: "keep me" });
res = mockRes();
await jobsHandler({ method: "POST", headers: auth, query: {}, body: { action: "import" } }, res);
check("instructions survive an import run", (await store.getJob(seeded.id)).instructions === "keep me");

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
