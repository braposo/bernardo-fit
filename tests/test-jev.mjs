import assert from "node:assert/strict";
import { tasks, idempotencyKeys } from "@trigger.dev/sdk";
import { evaluateJev, validateAnswers, jevEnabled } from "../lib/jev.js";
import { assessFit, scoringQuestions, scoringFingerprint } from "../lib/jev-scoring.js";
import { executeJevWork } from "../lib/jev-work.js";
import { routeAnswer } from "../lib/jev-routing.js";
import { answerPolicy } from "../lib/answer-policy.js";
import { jobSummary } from "../lib/job-view.js";
import { saveJob, getJob, mutateJob, saveReportWithId, getReport } from "../lib/store.js";
import { applyAnalysisToOwners } from "../lib/analysis-completion.js";
import { readUsage } from "../lib/usage.js";
import handler from "../api/admin/cover.js";
process.env.ADMIN_SECRET = "jev-test";
process.env.JEV_ENABLED = "1";
process.env.AI_GATEWAY_API_KEY = "synthetic-key";
let passed = 0, failed = 0, calls = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.error("  FAIL " + name, e); }
}
function fixture(questions) {
  return { answers: Object.fromEntries(Object.entries(questions).map(([key, q]) => [key, q.type === "boolean"
    ? { type: "boolean", probability: 0.99 } : q.type === "score"
    ? { type: "score", score: 3, confidence: 0.9, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0 } }
    : { type: "choice", choice: key === "constraint" ? "clear" : key === "route" ? "routine" : "complete", confidence: 0.95,
      probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === (key === "constraint" ? "clear" : key === "route" ? "routine" : "complete") ? 1 : 0])) }])),
    usage: { inputTokens: 150, outputTokens: 20 } };
}
let transform = x => x;
globalThis.fetch = async (url, options) => {
  calls++;
  assert.equal(url, "https://ai-gateway.vercel.sh/v1/evaluate");
  assert.equal(options.headers.Authorization, "Bearer synthetic-key");
  const body = JSON.parse(options.body);
  assert.equal(body.providerOptions.gateway.zeroDataRetention, true);
  return { ok: true, status: 200, json: async () => transform(fixture(body.questions)) };
};
const job = await saveJob({ company: "Example", role: "Engineering Manager", score: 55, jobDescription: "Remote UK engineering leadership role with AI products and developer tools." });
const basePolicy = answerPolicy({ question: "What attracted you to our opportunity?", model: "gpt-6-astra", economy: true, report: { pitch: "fit" } });
const routeOptions = { question: "What attracted you to our opportunity?", economy: true, report: { pitch: "fit" }, ref: "route" };
await test("disabled feature makes no calls", async () => {
  process.env.JEV_ENABLED = "0"; const before = calls;
  assert.equal(jevEnabled(), false);
  await assert.rejects(evaluateJev({}), /Enable Jev/);
  assert.deepEqual(await routeAnswer(basePolicy, routeOptions), basePolicy);
  assert.equal(calls, before); process.env.JEV_ENABLED = "1";
});
await test("rubrics normalise zero-indexed scores and retain reported confidence", async () => {
  const a = await assessFit(job, "fit"); assert.equal(a.score, 75); assert.equal(a.dimensions.length, 5);
  assert.equal(a.dimensions[0].confidence, 0.9); assert.equal(a.status, "complete");
  const usage = await readUsage("fit"); assert.equal(usage[0].input, 150); assert.equal(usage[0].estimatedCostMicros, null);
});
await test("unknown evidence withholds total rather than assigning zero or reweighting", async () => {
  transform = d => { d.answers.practicalKnown.probability = 0.2; return d; };
  const a = await assessFit(job); assert.equal(a.score, null); assert.equal(a.dimensions[4].score, null);
  assert.equal(a.status, "incomplete"); transform = x => x;
});
await test("bad posting and hard constraints remain distinct from capability scores", async () => {
  transform = d => { d.answers.posting.choice = "inaccessible"; d.answers.posting.probabilities = { complete: 0, partial: 0, inaccessible: 1, unrelated: 0 };
    d.answers.constraint.choice = "conflict"; d.answers.constraint.probabilities = { conflict: 1, clear: 0, unknown: 0 }; return d; };
  const a = await assessFit(job); assert.equal(a.score, null); assert.equal(a.blocked, true); transform = x => x;
});
await test("missing, malformed and out-of-range answers are rejected", async () => {
  const q = scoringQuestions();
  for (const modify of [d => delete d.answers.evidence, d => d.answers.scope.score = 5,
    d => d.answers.direction.confidence = 2, d => d.answers.posting.choice = "invented", d => d.answers.scope.probabilities[0] = 1]) {
    const d = fixture(q); modify(d); assert.throws(() => validateAnswers(d, q), /invalid assessment/);
  }
});
await test("high-confidence routine classification uses compact context; unknown confidence does not", async () => {
  assert.equal((await routeAnswer(basePolicy, routeOptions)).routing, "jev-routine");
  transform = d => { delete d.answers.route.confidence; return d; };
  const full = await routeAnswer(basePolicy, routeOptions); assert.equal(full.model, "gpt-6-astra"); assert.equal(full.compact, false);
  transform = x => x;
});
await test("custom instructions, facts and economy opt-out bypass classification", async () => {
  const before = calls;
  await routeAnswer(basePolicy, { ...routeOptions, instructions: "Use full examples" });
  await routeAnswer(basePolicy, { ...routeOptions, economy: false });
  await routeAnswer({ ...basePolicy, fact: "Confirmed" }, routeOptions);
  assert.equal(calls, before);
});
await test("provider failures are redacted, recorded and never downgrade answer quality", async () => {
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: "secret-response" }) });
  await assert.rejects(assessFit(job, "failure"), e => e.abort && !e.message.includes("secret-response"));
  const routed = await routeAnswer(basePolicy, routeOptions); assert.equal(routed.routing, "jev-unavailable-full"); assert.equal(routed.model, "gpt-6-astra");
  assert.equal((await readUsage("failure"))[0].httpStatus, 401); globalThis.fetch = fetch;
});
async function claim(id, requestId) {
  const fingerprint = scoringFingerprint(await getJob(id));
  await mutateJob(id, () => ({ jevRun: { requestId, fingerprint, status: "queued" } }));
  return { jobId: id, requestId, fingerprint };
}
await test("worker persists assessment once, retains legacy score, and keeps reports private", async () => {
  const payload = await claim(job.id, "jev-work-one");
  assert.equal((await executeJevWork(payload)).outcome, "completed"); const before = calls;
  await executeJevWork(payload); assert.equal(calls, before);
  const saved = await getJob(job.id); assert.equal(saved.score, 55); assert.equal(jobSummary(saved).score, 75);
  await saveReportWithId("jev-public", { company: "Example", pitch: "Public prose" }, null);
  await mutateJob(job.id, () => ({ fitReportId: "jev-public" }));
  await applyAnalysisToOwners("jev-public", { score: 95, tier: "Act now", breakdown: {}, reasoning: "Legacy" });
  assert.equal(jobSummary(await getJob(job.id)).score, 75);
  assert.equal(JSON.stringify(await getReport("jev-public")).includes("jev"), false);
});
await test("edits invalidate scores and stale in-flight results cannot attach", async () => {
  await mutateJob(job.id, () => ({ salary: "New salary" }));
  const summary = jobSummary(await getJob(job.id)); assert.equal(summary.jevStale, true); assert.equal(summary.score, null);
  const payload = await claim(job.id, "jev-work-two");
  const fetch = globalThis.fetch;
  globalThis.fetch = async (...args) => { await mutateJob(job.id, () => ({ location: "Changed mid-flight" })); return fetch(...args); };
  assert.equal((await executeJevWork(payload)).outcome, "superseded"); globalThis.fetch = fetch;
  assert.equal(jobSummary(await getJob(job.id)).jevStale, true);
});
await test("review and dispatch require auth, a current fingerprint and the fixed Jev model", async () => {
  const trigger = tasks.trigger, key = idempotencyKeys.create; let payload;
  tasks.trigger = async (id, p) => { assert.equal(id, "jev-score"); payload = p; return { id: "run-jev" }; };
  idempotencyKeys.create = async k => k;
  async function call(body, auth = true) {
    const res = { status(c) { this.code = c; return this; }, json(d) { this.body = d; return this; }, setHeader() {} };
    await handler({ method: "POST", headers: auth ? { "x-admin-secret": "jev-test" } : {}, body }, res); return res;
  }
  try {
    const body = { id: job.id, kind: "jev-score", model: "gpt-6-astra", requestId: "jev-dispatch-test" };
    assert.equal((await call(body, false)).code, 401);
    assert.equal((await call(body)).code, 409);
    const review = (await call({ ...body, action: "review" })).body.review;
    assert.equal(review.model, "typesafe-ai/jev"); assert.equal(payload, undefined);
    assert.equal((await call({ ...body, reviewFingerprint: review.fingerprint })).code, 202);
    assert.equal(payload.model, "typesafe-ai/jev"); assert.equal(payload.jobDescription, undefined);
    await mutateJob(job.id, () => ({ instructions: "Changed preferences" }));
    assert.equal((await call({ ...body, requestId: "jev-dispatch-stale", reviewFingerprint: review.fingerprint })).code, 409);
  } finally { tasks.trigger = trigger; idempotencyKeys.create = key; }
});
console.log(`passed ${passed}, failed ${failed}`);
process.exitCode = failed ? 1 : 0;
