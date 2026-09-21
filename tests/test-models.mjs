process.env.ADMIN_SECRET = "test-secret-value";
process.env.ANTHROPIC_API_KEY = "sk-fake";
process.env.OPENAI_API_KEY = "sk-fake";
// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";
const lib = "file:///" + root + "lib/";

import fs from "node:fs";

let sent = [];
let stopReason = "end_turn";
globalThis.fetch = async (_u, opts) => {
  const body = JSON.parse(opts.body);
  sent.push(body.model);
  if (_u.includes("api.openai.com")) return { ok: true, status: 200, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ job_title: "T", company: "C", pitch: "p", categories: [], differentiators: [], closing: "c" }) }] }] }) };
  return {
    ok: true,
    json: async () => ({
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: JSON.stringify({
            job_title: "T", company: "C", pitch: "p", categories: [], differentiators: [], closing: "c",
            internal: { score: 60, tier: "Worth a look", breakdown: { location: 1, aiDx: 1, leadership: 1 }, reasoning: "r" },
            salutation: "Dear team,", paragraphs: [{ lead: true, text: "A first paragraph with enough words." }],
          }) },
      ],
      stop_reason: stopReason,
      stop_details: stopReason === "refusal" ? { type: "refusal", category: "cyber", explanation: "nope" } : null,
    }),
  };
};

const M = await import(lib + "models.js");
const store = await import(lib + "store.js");
const { runAnalysis } = await import(lib + "analyze.js");
const { runCoverLetter } = await import(lib + "cover.js");
const { executeCoverWork } = await import(lib + "cover-work.js");
const { coverFingerprint } = await import(lib + "generation-fingerprint.js");
const { runAnswer } = await import(lib + "answer.js");
const { analyseHandler: analyse, regenerateHandler: regen, answerHandler: answer } = await import("./release-d-harness.mjs");

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
const reset = () => { sent = []; };
const SOL = "gpt-5.6-sol", ASTRA = "gpt-6-astra";
const OPUS = "claude-opus-5", SONNET = "claude-sonnet-5";

console.log("\n--- the model list ---");
check("sol is the default", M.DEFAULT_MODEL === SOL);
check("four models offered, default first", M.MODELS.map((m) => m.id).join() === [SOL, ASTRA, OPUS, SONNET].join(), M.MODELS.map((m) => m.id));
check("ids carry no date suffix", M.MODELS.every((m) => !/\d{8}$/.test(m.id)));
check("resolves a known id", M.resolveModel(SONNET) === SONNET);
check("falls back to the default on rubbish", M.resolveModel("gpt-4") === SOL);
check("falls back on empty", M.resolveModel("") === SOL && M.resolveModel(undefined) === SOL);
check("labels", M.modelLabel(OPUS) === "Opus" && M.modelLabel(SONNET) === "Sonnet");

console.log("\n--- generators send what they are given ---");
reset(); await runAnalysis("A long enough job description for a role.", { model: OPUS });
check("analysis: opus", sent[0] === OPUS, sent);
reset(); await runAnalysis("A long enough job description for a role.");
check("analysis: defaults to sol", sent[0] === SOL, sent);
reset(); await runCoverLetter({ report: { job_description: "x" }, fitUrl: "https://x", model: OPUS });
check("cover: opus", sent[0] === OPUS, sent);
reset(); await runAnswer({ question: "Why us?", limit: 100, model: OPUS });
check("answer: opus", sent[0] === OPUS, sent);
reset(); await runAnalysis("Another job description here.", { model: "claude-opus-5-20260101" });
check("an unknown id uses the default", sent[0] === SOL, sent);

console.log("\n--- thinking blocks do not corrupt parsing ---");
const { report } = await runAnalysis("A job description for a platform role.", { model: OPUS });
check("parsed past the thinking block", report.company === "C", report);

console.log("\n--- refusals surface clearly ---");
stopReason = "refusal";
let threw = null;
try { await runAnalysis("A job description.", { model: OPUS }); } catch (e) { threw = e; }
check("analysis throws on refusal", !!threw && /declined/.test(threw.message), threw && threw.message);
check("with a useful status", threw && threw.status === 502);
check("and says why", threw && /nope|cyber/.test(threw.message));
threw = null;
reset();
try { await runCoverLetter({ report: { job_description: "x" }, fitUrl: "https://x", model: OPUS }); } catch (e) { threw = e; }
check("cover throws on refusal", !!threw && /declined/.test(threw.message));
check("and does not burn the retry", sent.length === 1, sent.length);
stopReason = "end_turn";

console.log("\n--- endpoints pass it through ---");
const job = await store.saveJob({ company: "C", role: "R", jobDescription: "A long enough job description for a leadership role." });
reset();
let res = mockRes();
await analyse({ method: "POST", headers: auth, body: { id: job.id, model: OPUS } }, res);
check("analyse: 200", res.statusCode === 200, res.body);
check("analyse: used opus", sent[0] === OPUS, sent);
check("analyse: reports the model", res.body.model === OPUS, res.body);
check("analyse: stamped on the report", (await store.getReport((await store.getJob(job.id)).fitReportId)).model === OPUS);

console.log("\n--- a different model means a fresh run, not a cache hit ---");
const twin = await store.saveJob({ company: "C2", role: "R", jobDescription: "A long enough job description for a leadership role." });
reset();
res = mockRes();
await analyse({ method: "POST", headers: auth, body: { id: twin.id, model: SONNET } }, res);
check("did not reuse the opus report", res.body.cached !== true, res.body);
check("made a real call", sent.length === 1, sent);
check("with sonnet", sent[0] === SONNET, sent);
const twin2 = await store.saveJob({ company: "C3", role: "R", jobDescription: "A long enough job description for a leadership role." });
reset();
res = mockRes();
await analyse({ method: "POST", headers: auth, body: { id: twin2.id, model: SONNET } }, res);
check("same model still dedupes", res.body.cached === true, res.body);
check("and costs nothing", sent.length === 0, sent);

console.log("\n--- regenerate, cover and answer ---");
reset();
res = mockRes();
await regen({ method: "POST", headers: auth, body: { id: (await store.getJob(job.id)).fitReportId, jobId: job.id, model: OPUS } }, res);
check("regenerate: used opus", sent[0] === OPUS, sent);
check("regenerate: stamped", (await store.getReport((await store.getJob(job.id)).fitReportId)).model === OPUS);

reset();
const coverJob = await store.getJob(job.id);
const coverReport = await store.getReport(coverJob.fitReportId);
const coverPrint = coverFingerprint(coverJob, coverReport, OPUS);
await store.updateJob(job.id, { coverRun: { requestId: "modelreq1", fingerprint: coverPrint, status: "queued" } });
const coverOut = await executeCoverWork({ jobId: job.id, requestId: "modelreq1", fingerprint: coverPrint, model: OPUS, origin: "https://fit.bernardoraposo.com" });
check("cover: completed", coverOut.outcome === "completed", coverOut);
check("cover: used opus", sent[0] === OPUS, sent);
check("cover: recorded on the row", (await store.getJob(job.id)).coverLetterModel === OPUS);
check("cover: reported back", coverOut.words > 0);
check("and leaves the recorded model alone", (await store.getJob(job.id)).coverLetterModel === OPUS);

await store.updateJob(job.id, { questions: [{ id: "q1", q: "Why us?", limit: 100 }] });
reset();
res = mockRes();
await answer({ method: "POST", headers: auth, body: { id: job.id, questionId: "q1", model: OPUS } }, res);
check("answer: used opus", sent[0] === OPUS, sent);
check("answer: reported back", res.body.model === OPUS);

console.log("\n--- the public endpoint cannot be steered ---");
const publicSrc = fs.readFileSync(root + "api/analyze.js", "utf8");
const publicWorkSrc = fs.readFileSync(root + "lib/public-analysis-work.js", "utf8");
check("takes no model from the body", !/req\.body[\s\S]{0,120}model/.test(publicSrc));
check("worker forwards the Jev-selected model", /runAnalysis\(jd, \{ model,/.test(publicWorkSrc));
check("and that model is the cheap one", M.PUBLIC_MODEL === SONNET, M.PUBLIC_MODEL);
check("and records it, so admin dedup does not mistake it for the default", /report.model = model/.test(publicWorkSrc));
check("the task payload cannot steer the model", !/payload\.model|model:\s*payload/.test(publicWorkSrc));

console.log("\n--- the page ---");
const html = fs.readFileSync(root + "public/admin.html", "utf8");
check("picker present in the generation review", html.includes('data-review-model'));
check("persisted", html.includes('localStorage.setItem(MODEL_KEY, model)'));
check("page defaults to sol", html.includes('localStorage.getItem(MODEL_KEY) || "gpt-5.6-sol"'));
check("guards a bad stored value", html.includes('if (!MODELS.some('));
check("review sends the selected model", html.includes('model: modelEl ? modelEl.value : model'));
check("analysis and letter use shared review", html.includes("kind: 'analyse'") && html.includes("kind: 'cover'"));
check("regenerate uses shared review", html.includes("kind: 'regenerate'"));
check("answers use shared review", html.includes("kind: 'answer', questionId: qid"));
check("letter token minting carries no model", html.includes('action: "letter-token", id: id'));
check("shows which model wrote the letter", html.includes('modelLabel(j.coverLetterModel)'));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
