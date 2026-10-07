import assert from "node:assert/strict";
import { tasks, idempotencyKeys } from "@trigger.dev/sdk";
import { evaluateJev, validateAnswers, jevEnabled } from "../lib/jev.js";
import { assessFit, scoringQuestions, scoringFingerprint, scoringInput } from "../lib/jev-scoring.js";
import { summariseOverview } from "../lib/overview-summary.js";
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
    assert.equal(body.model, "gpt-6.1-sol"); assert.equal(body.store, false);
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
  assert.deepEqual(Object.keys(scoringQuestions()), ["responsibilities", "evidence", "scope", "direction", "practical", "posting", "constraint"]);
  const usage = await readUsage("fit"); assert.equal(usage[0].input, 150); assert.equal(usage[0].estimatedCostMicros, 6);
});
await test("strong matches can still score highly, while plausible matches remain calibrated", async () => {
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
    assert.equal((await assessFit(job)).score, 55, "poor daily work fit retains its scoring ceiling independently of admission policy");
    transform = d => { for (const key of Object.keys(d.answers).filter(k => d.answers[k].type === "score")) {
      const rung = key === "evidence" ? 2 : 4;
      d.answers[key].score = rung;
      d.answers[key].probabilities = Object.fromEntries([0, 1, 2, 3, 4].map(i => [i, Number(i === rung)]));
    } return d; };
    assert.equal((await assessFit(job)).score, 70, "unproven essential capabilities cannot yield a top score");
  } finally { transform = x => x; }
});
await test("sustainable management weights favour practical fit without a career progression gate", async () => {
  const withRatings = overrides => d => {
    for (const [key, answer] of Object.entries(d.answers).filter(([, a]) => a.type === "score")) {
      const rung = overrides[key] ?? 4;
      answer.score = rung;
      answer.probabilities = Object.fromEntries([0, 1, 2, 3, 4].map(i => [i, Number(i === rung)]));
    }
    return d;
  };
  try {
    transform = withRatings({ direction: 0 });
    const assessment = await assessFit(job);
    assert.deepEqual(assessment.dimensions.map(({id, weight}) => [id, weight]), [
      ['responsibilities', 30], ['evidence', 30], ['scope', 15], ['direction', 5], ['practical', 20],
    ]);
    assert.equal(assessment.score, 95, 'career direction only contributes its five percent; it cannot cap strong employment fit');
    transform = withRatings({ practical: 3 });
    assert.equal((await assessFit(job)).score, 93, 'a 35-point practical difference contributes seven overall points');
    transform = withRatings({ evidence: 1 });
    assert.equal((await assessFit(job)).score, 55, 'essential capability still guards against a poor fit');
  } finally { transform = x => x; }
});
await test("standalone Jev makes one attempt and preserves provider retry metadata", async () => {
  const original=globalThis.fetch; let attempts=0;
  try {
    for(const status of [429,529]) {
      globalThis.fetch=async()=>{attempts++;return {ok:false,status,headers:new Headers({'retry-after':'60'})};};
      const before=attempts;
      await assert.rejects(assessFit(job,'native-backoff-'+status),error=>error.providerStatus===status && error.retryAt instanceof Date && !error.abort);
      assert.equal(attempts,before+1);
    }
    globalThis.fetch=async()=>({ok:false,status:422});
    await assert.rejects(assessFit(job,'bad-input'),error=>error.abort && error.status===422);
  } finally {globalThis.fetch=original;}
});

await test("rejects mismatched model and malformed native Noul answers", async () => {
  try {
    transform = d => ({ ...d, model: "jev-unexpected" });
    await assert.rejects(assessFit(job, "model-mismatch"), /invalid assessment/);
    assert.throws(() => validateAnswers({ answers: { check: { type: "noul", noul: 1.5 } } },
      { check: { type: "boolean" } }), /invalid assessment/);
  } finally { transform = x => x; }
});
await test("model confidence never caps a fit rating or makes a complete posting provisional", async () => {
  try {
    for (const confidence of [0, 0.59, 0.69, 0.7, 0.79, 0.8, null]) {
      transform = d => { for (const answer of Object.values(d.answers).filter(a => a.type === "score")) answer.confidence = confidence; return d; };
      const a = await assessFit(job);
      assert.equal(a.score, 65); assert.equal(a.status, "complete"); assert.equal(a.provisional, false);
      assert.ok(a.dimensions.every(d => d.score === 65 && d.confidence === confidence));
      assert.ok(a.dimensions.every(d => !('evidenceLimited' in d) && !('evidenceProbability' in d) && !('evidenceNote' in d)));
    }
  } finally { transform = x => x; }
});
await test("all factual job fields invalidate assessments, but workflow metadata does not", () => {
  const original = scoringFingerprint(job);
  for (const field of ["company", "role", "jobDescription", "location", "locationMode", "salary", "instructions", "notes"]) {
    assert.notEqual(scoringFingerprint({ ...job, [field]: "Changed context" }), original, field);
  }
  for (const field of ["stage", "recruiter", "score", "overviewSummary", "answers"]) {
    assert.equal(scoringFingerprint({ ...job, [field]: "Unrelated metadata" }), original, field);
  }
  assert.equal(scoringInput({}).notes, "");
});
await test("scoring and overview receive the same factual recruiter notes", async () => {
  const contextualJob = { ...job, notes: "Recruiter discussed £120k+; base versus total not confirmed. UK remote permitted." };
  const originalFetch = globalThis.fetch;
  const inputs = {};
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.includes("typesafe.ai")) inputs.score = body.state;
    else inputs.overview = JSON.parse(body.input[0].content);
    return originalFetch(url, options);
  };
  try {
    const assessment = await assessFit(contextualJob);
    await summariseOverview(contextualJob, assessment);
    assert.deepEqual(inputs.score, scoringInput(contextualJob));
    assert.equal(inputs.overview.notes, contextualJob.notes);
    assert.deepEqual(inputs.overview.opportunity, inputs.score.opportunity);
    assert.equal(inputs.overview.preferences, inputs.score.preferences);
    assert.equal(inputs.overview.candidate, inputs.score.candidate);
  } finally { globalThis.fetch = originalFetch; }
});
await test("previously borderline sufficiency no longer lowers supported ratings", async () => {
  try {
    const ratings = [3.28, 3.04, 2.92, 3.39, 3.3];
    const confidences = [0.7, 0.81, 0.67, 0.59, 0.59];
    transform = d => {
      Object.values(d.answers).filter(a => a.type === "score").forEach((answer, i) => {
        answer.score = ratings[i]; answer.confidence = confidences[i];
      });
      return d;
    };
    const a = await assessFit(job);
    assert.deepEqual(a.dimensions.map(d => d.score), [75, 66, 63, 79, 76]);
    assert.equal(a.score, 71); assert.equal(a.status, "complete");
  } finally { transform = x => x; }
});
await test("incomplete postings retain their separate conservative guard", async () => {
  try {
    transform = d => { d.answers.posting.choice = "partial"; d.answers.posting.probabilities = { complete: 0, partial: 1, inaccessible: 0, unrelated: 0 }; return d; };
    const partial = await assessFit(job); assert.equal(partial.score, 65); assert.equal(partial.provisional, true);
    transform = d => { for (const key of Object.keys(d.answers).filter(k => d.answers[k].type === "score")) {
      d.answers[key].score = 4; d.answers[key].probabilities = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 };
    } d.answers.posting.choice = "partial"; d.answers.posting.probabilities = { complete: 0, partial: 1, inaccessible: 0, unrelated: 0 }; return d; };
    assert.equal((await assessFit(job)).score, 70, "an explicitly partial posting retains its separate cap");
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
await test("concurrent roles keep independent request ownership and results", async () => {
  const one = await saveJob({ company:'Concurrent one', role:'Manager', jobDescription:'Engineering leadership with developer tools.' });
  const two = await saveJob({ company:'Concurrent two', role:'Director', jobDescription:'Platform engineering strategy and technical leadership.' });
  const payloads = await Promise.all([claim(one.id,'parallel-one'),claim(two.id,'parallel-two')]);
  const originalFetch = globalThis.fetch;
  let arrivals = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async (...args) => {
    if (args[0] === 'https://api.typesafe.ai/v1/systemone') { if (++arrivals === 2) release(); await barrier; }
    return originalFetch(...args);
  };
  try {
    const results = await Promise.all(payloads.map(executeJevWork));
    assert.deepEqual(results.map(r=>r.outcome), ['completed','completed']);
    for(const payload of payloads) {
      const saved = await getJob(payload.jobId);
      assert.equal(saved.jevRun.requestId, payload.requestId);
      assert.equal(saved.jevRun.status, 'completed');
      assert.equal(saved.jevAssessment.fingerprint, payload.fingerprint);
      assert.ok(saved.overviewSummary);
    }
  } finally { globalThis.fetch = originalFetch; }
});
await test("edits mark saved scores outdated and stale in-flight results cannot attach", async () => {
  await mutateJob(job.id, () => ({ salary: "New salary" }));
  const summary = jobSummary(await getJob(job.id)); assert.equal(summary.jevStale, true); assert.equal(summary.score, 65);
  assert.equal(jobDetail(await getJob(job.id)).overviewSummary, null);
  const payload = await claim(job.id, "jev-work-two");
  const fetch = globalThis.fetch;
  globalThis.fetch = async (...args) => { await mutateJob(job.id, () => ({ notes: "Recruiter clarification changed mid-flight" })); return fetch(...args); };
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
    if (args[0].includes("openai.com")) await mutateJob(job.id, () => ({ notes: "Recruiter clarification edited during summary" }));
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
    await mutateJob(job.id, () => ({ notes: "Recruiter clarification after review" }));
    assert.equal((await call({ ...body, requestId: "jev-dispatch-stale", reviewFingerprint: review.fingerprint })).code, 409);
  } finally { tasks.trigger = trigger; idempotencyKeys.create = key; }
});
console.log(`passed ${passed}, failed ${failed}`);
process.exitCode = failed ? 1 : 0;
