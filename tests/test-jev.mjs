import assert from "node:assert/strict";
import { tasks, idempotencyKeys } from "@trigger.dev/sdk";
import { evaluateJev, validateAnswers, jevEnabled } from "../lib/jev.js";
import { assessFit, scoringQuestions, scoringFingerprint } from "../lib/jev-scoring.js";
import { executeJevWork } from "../lib/jev-work.js";
import { routeAnswer } from "../lib/jev-routing.js";
import { answerPolicy } from "../lib/answer-policy.js";
import { jobSummary, jobDetail } from "../lib/job-view.js";
import { saveJob, getJob, mutateJob, saveReportWithId, getReport } from "../lib/store.js";
import { applyAnalysisToOwners } from "../lib/analysis-completion.js";
import { readUsage } from "../lib/usage.js";
import handler from "../api/admin/cover.js";
process.env.OPENAI_API_KEY = "synthetic-openai";
process.env.ADMIN_SECRET = "jev-test";
process.env.TYPESAFE_API_KEY = "synthetic-key";
let passed = 0, failed = 0, calls = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.error("  FAIL " + name, e); }
}
function fixture(questions) {
  return { model: "jev-1.13.0", answers: Object.fromEntries(Object.entries(questions).map(([key, q]) => [key, ["boolean", "noul"].includes(q.type)
    ? { type: "noul", noul: 0.99 } : q.type === "score"
    ? { type: "score", score: 3, confidence: 0.9, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0 } }
    : { type: "choice", choice: key === "constraint" ? "clear" : key === "route" ? "routine" : "complete", confidence: 0.95,
      probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === (key === "constraint" ? "clear" : key === "route" ? "routine" : "complete") ? 1 : 0])) }])),
    usage: { input_tokens: 150, output_tokens: 20 } };
}
let transform = x => x;
await test("historical scores do not reach job views", () => {
  const job = { score: 88, tier: "Act now", scoreBreakdown: { fit: 88 }, rationale: "Old scoring explanation" };
  for (const view of [jobSummary(job), jobDetail(job)]) {
    assert.equal(view.score, null);
    assert.equal(view.tier, "");
    assert.equal(view.scoreBreakdown, null);
    assert.equal(view.rationale, "");
    assert.equal("legacyScore" in view, false);
  }
});
let summaryText = JSON.stringify({ position: "Lead the engineering team.", fit: "Strong leadership alignment with practical details to confirm." });
let summaryCalls = 0;
globalThis.fetch = async (url, options) => {
  calls++;
  if (url === "https://api.openai.com/v1/responses") {
    summaryCalls++;
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gpt-5.6-sol"); assert.equal(body.store, false);
    assert.equal(body.reasoning.effort, "low");
    assert.ok(body.instructions.includes("Do not recompute or change scores"));
    return { ok: true, status: 200, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: summaryText }] }], usage: { input_tokens: 100, output_tokens: 30 } }) };
  }
  assert.equal(url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(options.headers.Authorization, "Bearer synthetic-key");
  const body = JSON.parse(options.body);
  assert.equal(body.model, "jev-1.13.0");
  assert.equal(body.providerOptions, undefined);
  assert.ok(Object.values(body.questions).every(q => q.type !== "boolean"));
  return { ok: true, status: 200, json: async () => transform(fixture(body.questions)) };
};
const job = await saveJob({ company: "Example", role: "Engineering Manager", score: 55, jobDescription: "Remote UK engineering leadership role with AI products and developer tools." });
const basePolicy = answerPolicy({ question: "What attracted you to our opportunity?", model: "gpt-6-astra", economy: true, report: { pitch: "fit" } });
const routeOptions = { question: "What attracted you to our opportunity?", economy: true, report: { pitch: "fit" }, ref: "route" };
await test("missing TypeSafe key makes no calls; key alone enables Jev", async () => {
  delete process.env.TYPESAFE_API_KEY; const before = calls;
  assert.equal(jevEnabled(), false);
  assert.equal(jevEnabled({ TYPESAFE_API_KEY: "   " }), false);
  await assert.rejects(evaluateJev({}), /Configure TYPESAFE_API_KEY/);
  assert.deepEqual(await routeAnswer(basePolicy, routeOptions), basePolicy);
  assert.equal(calls, before); process.env.TYPESAFE_API_KEY = "synthetic-key";
  assert.equal(jevEnabled(), true);
});
await test("rubrics normalise zero-indexed scores and retain reported confidence", async () => {
  const a = await assessFit(job, "fit"); assert.equal(a.score, 65); assert.equal(a.dimensions.length, 5);
  assert.equal(a.dimensions[0].confidence, 0.9); assert.equal(a.status, "complete");
  assert.deepEqual(a.dimensions[0].probabilities, { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0 });
  assert.match(scoringQuestions().responsibilities.instructions, /level 3 requires clear evidence/);
  const usage = await readUsage("fit"); assert.equal(usage[0].input, 150); assert.equal(usage[0].estimatedCostMicros, 6);
});
await test("strong matches can still score highly, while plausible matches stay below screening threshold", async () => {
  try {
    transform = d => { for (const key of Object.keys(d.answers).filter(k => d.answers[k].type === "score")) {
      d.answers[key].score = 4; d.answers[key].probabilities = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 };
    } return d; };
    assert.equal((await assessFit(job)).score, 100);
    transform = d => { for (const key of Object.keys(d.answers).filter(k => d.answers[k].type === "score")) {
      d.answers[key].score = 2; d.answers[key].probabilities = { 0: 0, 1: 0, 2: 1, 3: 0, 4: 0 };
    } return d; };
    assert.equal((await assessFit(job)).score, 40);
  } finally { transform = x => x; }
});
await test("a weak central match cannot be hidden by high scores elsewhere", async () => {
  try {
    transform = d => { for (const key of Object.keys(d.answers).filter(k => d.answers[k].type === "score")) {
      const rung = key === "responsibilities" ? 1 : 4;
      d.answers[key].score = rung;
      d.answers[key].probabilities = Object.fromEntries([0, 1, 2, 3, 4].map(i => [i, Number(i === rung)]));
    } return d; };
    assert.equal((await assessFit(job)).score, 55, "poor daily work fit stays below the default ingest threshold");
    transform = d => { for (const key of Object.keys(d.answers).filter(k => d.answers[k].type === "score")) {
      const rung = key === "evidence" ? 2 : 4;
      d.answers[key].score = rung;
      d.answers[key].probabilities = Object.fromEntries([0, 1, 2, 3, 4].map(i => [i, Number(i === rung)]));
    } return d; };
    assert.equal((await assessFit(job)).score, 70, "unproven essential capabilities cannot yield a top score");
  } finally { transform = x => x; }
});
await test("direct API retries throttling and overload with bounded backoff", async () => {
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async (...args) => ++attempts < 3
    ? { ok: false, status: attempts === 1 ? 429 : 529, headers: new Headers({ "retry-after": "0" }) }
    : original(...args);
  try {
    await assessFit(job, "backoff");
    assert.equal(attempts, 3);
    assert.deepEqual((await readUsage("backoff")).map(x => x.httpStatus).sort(), [200, 429, 529]);
    attempts = 0;
    globalThis.fetch = async () => { attempts++; return { ok: false, status: 529, headers: new Headers({ "retry-after": "60" }) }; };
    await assert.rejects(assessFit(job, "long-backoff"), e => !e.abort && e.status === 502);
    assert.equal(attempts, 1, "never retry earlier than a long Retry-After");
    globalThis.fetch = async () => { attempts++; return { ok: false, status: 422 }; };
    await assert.rejects(assessFit(job, "bad-input"), e => e.abort && e.status === 422);
    assert.equal(attempts, 2, "invalid input is not retried");
  } finally { globalThis.fetch = original; }
});
await test("rejects mismatched model and malformed native Noul answers", async () => {
  try {
    transform = d => ({ ...d, model: "jev-unexpected" });
    await assert.rejects(assessFit(job, "model-mismatch"), /invalid assessment/);
    transform = d => { d.answers.practicalKnown = { type: "noul", noul: 1.5 }; return d; };
    await assert.rejects(assessFit(job, "invalid-noul"), /invalid assessment/);
  } finally { transform = x => x; }
});
await test("sparse evidence retains all ratings and weights with visible uncertainty", async () => {
  try {
    transform = d => { for (const key of Object.keys(d.answers).filter(k => k.endsWith("Known"))) d.answers[key].noul = 0.2;
      d.answers.practical.score = 1; d.answers.practical.probabilities = { 0: 0, 1: 1, 2: 0, 3: 0, 4: 0 }; return d; };
    const a = await assessFit({ ...job, jobDescription: "" });
    assert.equal(a.score, 38); assert.equal(a.dimensions[4].score, 20);
    assert.equal(a.status, "provisional"); assert.equal(a.provisional, true);
    assert.ok(a.dimensions.every(d => Number.isFinite(d.score) && d.evidenceLimited && d.evidenceNote));
    transform = d => { d.answers.posting.choice = "partial"; d.answers.posting.probabilities = { complete: 0, partial: 1, inaccessible: 0, unrelated: 0 }; return d; };
    const partial = await assessFit(job); assert.equal(partial.score, 65); assert.equal(partial.provisional, true);
    transform = d => { for (const key of Object.keys(d.answers).filter(k => d.answers[k].type === "score")) {
      d.answers[key].score = 4; d.answers[key].probabilities = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 };
    } d.answers.posting.choice = "partial"; d.answers.posting.probabilities = { complete: 0, partial: 1, inaccessible: 0, unrelated: 0 }; return d; };
    assert.equal((await assessFit(job)).score, 70, "a partial posting cannot claim a near-certain overall fit");
  } finally { transform = x => x; }
});
await test("bad posting and hard constraints remain distinct from capability scores", async () => {
  transform = d => { d.answers.posting.choice = "inaccessible"; d.answers.posting.probabilities = { complete: 0, partial: 0, inaccessible: 1, unrelated: 0 };
    d.answers.constraint.choice = "conflict"; d.answers.constraint.probabilities = { conflict: 1, clear: 0, unknown: 0 }; return d; };
  const a = await assessFit(job); assert.equal(a.score, 65); assert.equal(a.blocked, true); assert.equal(a.provisional, true); transform = x => x;
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
  const saved = await getJob(job.id); assert.equal(saved.overviewSummary.position, "Lead the engineering team.");
  assert.equal(jobSummary(saved).overviewSummary, undefined);
  assert.equal(jobDetail(saved).overviewSummary.fit, "Strong leadership alignment with practical details to confirm.");
  assert.equal(saved.score, 55); assert.equal(jobSummary(saved).score, 65);
  await saveReportWithId("jev-public", { company: "Example", pitch: "Public prose" }, null);
  await mutateJob(job.id, () => ({ fitReportId: "jev-public" }));
  await applyAnalysisToOwners("jev-public", { score: 95, tier: "Act now", breakdown: {}, reasoning: "Legacy" });
  assert.equal(jobSummary(await getJob(job.id)).score, 65);
  assert.equal((await getJob(job.id)).score, 55, "page completion also preserves historical scores");
  assert.equal(JSON.stringify(await getReport("jev-public")).includes("jev"), false);
});
await test("edits mark saved scores outdated and stale in-flight results cannot attach", async () => {
  await mutateJob(job.id, () => ({ salary: "New salary" }));
  const summary = jobSummary(await getJob(job.id)); assert.equal(summary.jevStale, true); assert.equal(summary.score, 65);
  assert.equal(jobDetail(await getJob(job.id)).overviewSummary, null);
  const payload = await claim(job.id, "jev-work-two");
  const fetch = globalThis.fetch;
  globalThis.fetch = async (...args) => { await mutateJob(job.id, () => ({ location: "Changed mid-flight" })); return fetch(...args); };
  assert.equal((await executeJevWork(payload)).outcome, "superseded"); globalThis.fetch = fetch;
  assert.equal(jobSummary(await getJob(job.id)).jevStale, true);
});
await test("summary failures retry without paying for scoring again", async () => {
  const payload = await claim(job.id, "summary-retry");
  const originalText = summaryText;
  summaryText = "not valid JSON";
  const before = calls, beforeSummary = summaryCalls;
  const previousAssessment = (await getJob(job.id)).jevAssessment;
  await assert.rejects(executeJevWork(payload), /overview summary/);
  assert.equal(calls - before, 2);
  assert.deepEqual((await getJob(job.id)).jevAssessment, previousAssessment, "failed summary preserves the previous assessment");
  summaryText = originalText;
  await executeJevWork(payload);
  assert.equal(calls - before, 3, "only the summary is retried");
  assert.equal(summaryCalls - beforeSummary, 2);
  assert.equal(jobDetail(await getJob(job.id)).overviewSummary.position, "Lead the engineering team.");
});
await test("summary completion cannot overwrite edited job context", async () => {
  const payload = await claim(job.id, "summary-race");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (args[0].includes("openai.com")) await mutateJob(job.id, () => ({ salary: "Edited during summary" }));
    return response;
  };
  try { assert.equal((await executeJevWork(payload)).outcome, "superseded");
    assert.equal(jobDetail(await getJob(job.id)).overviewSummary, null);
  } finally { globalThis.fetch = originalFetch; }
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
    await mutateJob(job.id, () => ({ jobDescription: "" }));
    const body = { id: job.id, kind: "jev-score", model: "gpt-6-astra", requestId: "jev-dispatch-test" };
    assert.equal((await call(body, false)).code, 401);
    assert.equal((await call(body)).code, 409);
    const review = (await call({ ...body, action: "review" })).body.review;
    assert.equal(review.model, "jev-1.13.0"); assert.equal(payload, undefined);
    assert.equal((await call({ ...body, reviewFingerprint: review.fingerprint })).code, 202);
    assert.equal(payload.model, "jev-1.13.0"); assert.equal(payload.jobDescription, undefined);
    await mutateJob(job.id, () => ({ instructions: "Changed preferences" }));
    assert.equal((await call({ ...body, requestId: "jev-dispatch-stale", reviewFingerprint: review.fingerprint })).code, 409);
  } finally { tasks.trigger = trigger; idempotencyKeys.create = key; }
});
console.log(`passed ${passed}, failed ${failed}`);
process.exitCode = failed ? 1 : 0;
