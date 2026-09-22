import assert from "node:assert/strict";
import { selectWritingModel } from "../lib/jev-model-routing.js";
import { resolveGenerationReview, assertReviewedScope } from "../lib/generation-review.js";
import { saveJob, updateJob } from "../lib/store.js";
import { runAnswer } from "../lib/answer.js";
import { buildSystemPrompt } from "../lib/profile.js";
import { runAnalysis } from "../lib/analyze.js";
import { executePublicAnalysisWork } from "../lib/public-analysis-work.js";
import { saveTaskInput } from "../lib/task-results.js";
import { publicAnalysisFingerprint } from "../lib/public-analysis.js";

process.env.TYPESAFE_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
let calls = 0, writing = 0, confidence = 0.95, broken = false, sentModel;
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  if (String(url).includes("/systemone")) {
    calls++;
    if (broken) return { ok: false, status: 503 };
    const choice = body.state.description.includes("complex") ? "gpt-6-astra" : "claude-sonnet-5";
    return { ok: true, status: 200, json: async () => ({ model: "jev-1.13.0", answers: { model: {
      type: "choice", choice, confidence,
      probabilities: Object.fromEntries(Object.keys(body.questions.model.criteria).map(k => [k, k === choice ? 1 : 0])),
    } } }) };
  }
  writing++; sentModel = body.model;
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text:
    body.messages[0].content.includes("Write my fit analysis") ? JSON.stringify({ pitch: "Prose", internal: { score: 99 } }) : "My answer." }], stop_reason: "end_turn" }) };
};
const job = await saveJob({ company: "Route", role: "Manager", jobDescription: "A straightforward engineering management opportunity.",
  questions: [{ id: "q1", q: "Why this company?", limit: 100 }] });
const body = { kind: "analyse", id: job.id, model: "gpt-6-astra" };
const first = await resolveGenerationReview(body);
assert.equal(first.model, "claude-sonnet-5");
assert.equal(first.review.routing.source, "jev");
assert.equal(writing, 0);
const submitted = await resolveGenerationReview({ ...body, reviewFingerprint: first.fingerprint });
assertReviewedScope({ ...body, reviewFingerprint: first.fingerprint }, submitted);
assert.equal(calls, 1, "submission reuses routing decision");
assert.equal(submitted.payload.model, first.model);
await updateJob(job.id, { jobDescription: "A complex engineering management opportunity requiring strategic synthesis." });
const changed = await resolveGenerationReview(body);
assert.equal(changed.model, "gpt-6-astra");
assert.throws(() => assertReviewedScope({ ...body, reviewFingerprint: first.fingerprint }, changed));
const simple = await saveJob({ company: "Simple", role: "EM", jobDescription: "A straightforward second management opportunity." });
const batch = await resolveGenerationReview({ kind: "analyse-all", jobIds: [job.id, simple.id] });
assert.deepEqual(new Set(batch.payload.jobs.map(j => j.model)), new Set(["gpt-6-astra", "claude-sonnet-5"]));
confidence = null;
assert.equal((await selectWritingModel({ kind: "cover", job })).model, "gpt-5.6-sol");
broken = true;
await assert.rejects(selectWritingModel({ kind: "research", job }), /failed/);
broken = false;
const before = calls;
await runAnswer({ question: "Why this company?", limit: 100, report: { pitch: "Evidence" },
  model: "claude-opus-5", economy: true, modelRouting: true });
assert.equal(sentModel, "claude-opus-5", "economy context cannot override Jev's selected writer");
assert.equal(calls, before, "writer does not reroute");
assert.ok(!buildSystemPrompt({}).stable.includes('"internal"'));
const analysis = await runAnalysis("A role description", { model: "claude-sonnet-5" });
assert.equal(analysis.internal, null);
assert.ok(!("internal" in analysis.report));
assert.equal(calls, before, "page generation does not invoke scoring");
confidence = 0.95;
const jd = "A straightforward public engineering management opportunity.";
await saveTaskInput("public-analysis", "public-routing", jd);
const publicPayload = { requestId: "public-routing", inputId: "public-routing", fingerprint: publicAnalysisFingerprint(jd) };
await executePublicAnalysisWork(publicPayload);
assert.equal(calls, before + 1, "public page routes through Jev once");
assert.equal(sentModel, "claude-sonnet-5");
const publicWriting = writing;
await executePublicAnalysisWork(publicPayload);
assert.equal(calls, before + 1);
assert.equal(writing, publicWriting, "public retry reuses the page without any model calls");
console.log("passed 1, failed 0");
