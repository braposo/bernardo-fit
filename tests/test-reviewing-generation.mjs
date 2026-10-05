process.env.ADMIN_SECRET = "reviewing-test";
import assert from "node:assert/strict";
import { tasks, runs, idempotencyKeys } from "@trigger.dev/sdk";
import handler from "../api/admin/jobs.js";
import { ensureReviewingGeneration, reviewingGenerationResult } from "../lib/reviewing-generation.js";
import { executeAnalysisWithFollowup } from "../lib/analysis-with-followup.js";
import { getRunReceipt } from "../lib/run-receipts.js";
import * as store from "../lib/store.js";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (error) { failed++; console.log("  FAIL " + name + "\n" + error.stack); }
}
const originals = { trigger: tasks.trigger, retrieve: runs.retrieve, key: idempotencyKeys.create };
const dispatched = new Map();
let rejectDispatch = false;
tasks.trigger = async (taskId, payload, options) => {
  if (rejectDispatch) throw new Error("Worker unavailable");
  if (!dispatched.has(options.idempotencyKey)) dispatched.set(options.idempotencyKey, { taskId, payload, id: "run-" + dispatched.size });
  return { id: dispatched.get(options.idempotencyKey).id };
};
runs.retrieve = async id => ({ id, status: "EXECUTING" });
idempotencyKeys.create = async (key, options) => { assert.equal(options.scope, "global"); return key; };
const create = extra => store.saveJob({ company: "Synthetic", role: "Manager", jobDescription: "Lead a team building dependable software for customers.", ...extra });
const report = () => store.saveReport({ company: "Synthetic", job_title: "Manager", job_description: "Lead a team building dependable software for customers.", created_at: new Date().toISOString() });
async function call(method, body, id) {
  const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; }, setHeader() {} };
  await handler({ method, body, query: { id }, headers: { "x-admin-secret": "reviewing-test" } }, res);
  return res;
}
try {
  await test("moving to reviewing queues analysis and exposes recoverable run pointer", async () => {
    const job = await create();
    const response = await call("PATCH", { stage: "reviewing" }, job.id);
    assert.equal(response.code, 200);
    assert.equal(response.body.job.stage, "reviewing");
    assert.equal(response.body.job.analysisRun.status, "queued");
    assert.equal(response.body.job.coverRun, null);
    const receipt = await getRunReceipt(response.body.job.analysisRun.runId);
    assert.equal(receipt.kind, "analyse");
    assert.deepEqual(response.body.generationErrors, []);
  });
  await test("after analysis exists only the missing cover is dispatched", async () => {
    const job = await create({ stage: "reviewing", fitReportId: await report() });
    const before = dispatched.size;
    await ensureReviewingGeneration(job.id);
    assert.equal(dispatched.size, before + 1);
    assert.equal([...dispatched.values()].at(-1).taskId, "cover-letter");
    assert.equal((await store.getJob(job.id)).analysisRun, null);
  });
  await test("existing cover is preserved while missing analysis is generated", async () => {
    const job = await create({ stage: "reviewing", coverLetter: ["Existing letter"] });
    await ensureReviewingGeneration(job.id);
    assert.equal([...dispatched.values()].at(-1).taskId, "fit-analysis");
    await store.updateJob(job.id, { fitReportId: await report() });
    const before = dispatched.size;
    await ensureReviewingGeneration(job.id);
    assert.equal(dispatched.size, before);
  });
  await test("concurrent and repeated requests share one provider idempotency key", async () => {
    const job = await create({ stage: "reviewing" });
    const before = dispatched.size;
    await Promise.all([ensureReviewingGeneration(job.id), ensureReviewingGeneration(job.id), ensureReviewingGeneration(job.id)]);
    await ensureReviewingGeneration(job.id);
    assert.equal(dispatched.size, before + 1);
  });
  await test("manual in-flight work is never replaced even with different inputs", async () => {
    const job = await create({ stage: "reviewing", analysisRun: { requestId: "manual", runId: "manual-run", fingerprint: "other", status: "queued" } });
    const before = dispatched.size;
    await ensureReviewingGeneration(job.id);
    assert.equal(dispatched.size, before);
    assert.equal((await store.getJob(job.id)).analysisRun.requestId, "manual");
  });
  await test("expired prior analysis is settled before missing work is retried", async () => {
    const job = await create({ stage: "reviewing", analysisRun: { requestId: "expired", runId: "expired-run", status: "queued" } });
    runs.retrieve = async id => ({ id, status: "EXPIRED" });
    await ensureReviewingGeneration(job.id);
    runs.retrieve = async id => ({ id, status: "EXECUTING" });
    const saved = await store.getJob(job.id);
    assert.notEqual(saved.analysisRun.requestId, "expired");
    assert.equal(saved.analysisRun.status, "queued");
  });
  await test("both existing documents are left untouched", async () => {
    const job = await create({ stage: "reviewing", fitReportId: await report(), coverLetterId: "existing-cover" });
    const before = dispatched.size;
    await ensureReviewingGeneration(job.id);
    assert.equal(dispatched.size, before);
    assert.equal((await store.getJob(job.id)).coverLetterId, "existing-cover");
  });
  await test("unrelated edits and non-reviewing or archived jobs never dispatch", async () => {
    const job = await create({ stage: "reviewing" });
    const before = dispatched.size;
    assert.equal((await call("PATCH", { notes: "A note" }, job.id)).code, 200);
    await ensureReviewingGeneration((await create({ stage: "applied" })).id);
    await ensureReviewingGeneration((await create({ stage: "reviewing", archived: true })).id);
    assert.equal(dispatched.size, before);
  });
  await test("dispatch failure preserves the stage and retries the same claimed request", async () => {
    const job = await create();
    rejectDispatch = true;
    const response = await call("PATCH", { stage: "reviewing" }, job.id);
    assert.equal(response.code, 200);
    assert.equal(response.body.job.stage, "reviewing");
    assert.deepEqual(response.body.generationErrors, ["Worker unavailable"]);
    const requestId = response.body.job.analysisRun.requestId;
    rejectDispatch = false;
    await ensureReviewingGeneration(job.id);
    assert.equal((await store.getJob(job.id)).analysisRun.requestId, requestId);
  });
  await test("insufficient description reports a generation error without losing status", async () => {
    const job = await create({ jobDescription: "Short" });
    const response = await call("PATCH", { stage: "reviewing" }, job.id);
    assert.equal(response.code, 200);
    assert.equal(response.body.job.stage, "reviewing");
    assert.match(response.body.generationErrors[0], /fuller job description/);
  });
  await test("creation directly in reviewing queues missing work", async () => {
    const response = await call("POST", { company: "Synthetic", stage: "reviewing", jobDescription: "Lead a team building dependable software for customers." });
    assert.equal(response.code, 200);
    assert.equal(response.body.job.analysisRun.status, "queued");
  });
  await test("follow-up cover failure retains published report and surfaces the error", async () => {
    const job = await create({ stage: "reviewing", fitReportId: await report() });
    process.env.COVER_DISPATCH_DISABLED = "1";
    const result = await reviewingGenerationResult(job);
    delete process.env.COVER_DISPATCH_DISABLED;
    assert.equal(result.job.fitReportId, job.fitReportId);
    assert.match(result.generationErrors[0], /temporarily paused/);
  });
  await test("worker recovery attaches its checkpoint and then dispatches cover without model replay", async () => {
    const job = await create({ stage: "reviewing" });
    await ensureReviewingGeneration(job.id);
    const payload = [...dispatched.values()].at(-1).payload;
    await store.saveReportWithId(payload.requestId, { company: "Synthetic", job_title: "Manager", job_description: job.jobDescription, model: payload.model });
    const result = await executeAnalysisWithFollowup(payload);
    assert.equal(result.outcome, "completed");
    const saved = await store.getJob(job.id);
    assert.equal(saved.fitReportId, payload.requestId);
    assert.equal(saved.coverRun.status, "queued");
    assert.equal([...dispatched.values()].at(-1).taskId, "cover-letter");
  });
  await test("worker keeps completed analysis when its cover dispatch fails", async () => {
    const job = await create({ stage: "reviewing" });
    await ensureReviewingGeneration(job.id);
    const payload = [...dispatched.values()].at(-1).payload;
    await store.saveReportWithId(payload.requestId, { company: "Synthetic", job_title: "Manager", job_description: job.jobDescription, model: payload.model });
    rejectDispatch = true;
    const result = await executeAnalysisWithFollowup(payload);
    rejectDispatch = false;
    assert.equal(result.outcome, "completed");
    assert.deepEqual(result.generationErrors, ["Worker unavailable"]);
    assert.equal((await store.getJob(job.id)).analysisRun.status, "completed");
  });
} finally {
  tasks.trigger = originals.trigger; runs.retrieve = originals.retrieve; idempotencyKeys.create = originals.key;
}
console.log(`passed ${passed}, failed ${failed}`);
process.exitCode = failed ? 1 : 0;
