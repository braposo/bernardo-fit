process.env.ADMIN_SECRET = "reviewing-test";
import assert from "node:assert/strict";
import { tasks, runs, idempotencyKeys } from "@trigger.dev/sdk";
import handler from "../api/admin/jobs.js";
import { ensureReviewingGeneration, reviewingGenerationResult } from "../lib/reviewing-generation.js";
import { executeAnalysisWithFollowup } from "../lib/analysis-with-followup.js";
import { getRunReceipt } from "../lib/run-receipts.js";
import * as store from "../lib/store.js";
import {createMemoryApplicationCvStore,withApplicationCvStore} from "../lib/application-cv-store.js";
import {withApplicationCvSource} from "../lib/application-cv-source.js";

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
const cvStore=createMemoryApplicationCvStore();
const cvSource={identity:{name:'Bernardo Raposo',headline:'Engineering Manager',contacts:[]},roles:[{id:'role',title:'Manager',company:'Synthetic',dates:'2020–2026',location:'',overviewEvidenceId:'evidence',evidence:[{id:'evidence',text:'Led a team.',sourceRef:{documentId:'source',revision:'r1',passage:'Led a team.'},contribution:'personal',status:'delivered',skills:[]}]}],education:[],projects:[],settings:{model:'gpt-5.6-sol',prompt:'Use evidence.',verifierPrompt:'Verify evidence.',maxWords:600,minBodyPx:13,layout:'classic'},fingerprint:'test-source'};
async function call(method, body, id) {
  const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; }, setHeader() {} };
  await handler({ method, body, query: { id }, headers: { "x-admin-secret": "reviewing-test" } }, res);
  return res;
}
try { await withApplicationCvStore(cvStore,()=>withApplicationCvSource(cvSource,async()=>{
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
  await test("after analysis exists the missing application CV is dispatched", async () => {
    const job = await create({ stage: "reviewing", fitReportId: await report() });
    const before = dispatched.size;
    await ensureReviewingGeneration(job.id);
    assert.equal(dispatched.size, before + 1);
    assert.equal([...dispatched.values()].at(-1).taskId, "application-cv");
    assert.equal((await store.getJob(job.id)).analysisRun, null);
    assert.equal((await cvStore.getApplicationCv(job.id)).run.status,'queued');
  });
  await test("existing cover is preserved while missing analysis is generated", async () => {
    const job = await create({ stage: "reviewing", coverLetter: ["Existing letter"] });
    await ensureReviewingGeneration(job.id);
    assert.equal([...dispatched.values()].at(-1).taskId, "fit-analysis");
    await store.updateJob(job.id, { fitReportId: await report() });
    const before = dispatched.size;
    await ensureReviewingGeneration(job.id);
    assert.equal(dispatched.size, before + 1);
    assert.equal([...dispatched.values()].at(-1).taskId, "application-cv");
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
  await test("an existing published CV and analysis are left untouched", async () => {
    const job = await create({ stage: "reviewing", fitReportId: await report(), coverLetterId: "existing-cover" });
    await cvStore.ensureApplicationCv(job);
    await cvStore.claimApplicationCvRun(job,{requestId:'existing-cv',fingerprint:'existing-fp',status:'queued'});
    await cvStore.saveApplicationCvVersion(job.id,{id:'existing-cv',fingerprint:'existing-fp',sourceSnapshot:cvSource,reportSnapshot:{id:job.fitReportId,report:{job_title:'Manager'}},
      content:{identity:cvSource.identity,experience:[]},validation:{status:'valid'},pdfBuffer:Buffer.from('%PDF-1.7\nexisting\n%%EOF')});
    await cvStore.publishApplicationCvVersion(job.id,'existing-cv',{expectedRequestId:'existing-cv',expectedFingerprint:'existing-fp'});
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
  await test("follow-up CV dispatch failure retains published report and surfaces the error", async () => {
    const job = await create({ stage: "reviewing", fitReportId: await report() });
    rejectDispatch = true;
    const result = await reviewingGenerationResult(job);
    rejectDispatch = false;
    assert.equal(result.job.fitReportId, job.fitReportId);
    assert.match(result.generationErrors[0], /Worker unavailable/);
  });
  await test("worker recovery attaches its checkpoint and then dispatches CV without model replay", async () => {
    const job = await create({ stage: "reviewing" });
    await ensureReviewingGeneration(job.id);
    const payload = [...dispatched.values()].at(-1).payload;
    await store.saveReportWithId(payload.requestId, { company: "Synthetic", job_title: "Manager", job_description: job.jobDescription, model: payload.model });
    const result = await executeAnalysisWithFollowup(payload);
    assert.equal(result.outcome, "completed");
    const saved = await store.getJob(job.id);
    assert.equal(saved.fitReportId, payload.requestId);
    assert.equal((await cvStore.getApplicationCv(job.id)).run.status, "queued");
    assert.equal([...dispatched.values()].at(-1).taskId, "application-cv");
  });
  await test("worker dispatches the CV without the app-only storage guard", async () => {
    const job = await create({ stage: "reviewing" });
    await ensureReviewingGeneration(job.id);
    const payload = [...dispatched.values()].at(-1).payload;
    await store.saveReportWithId(payload.requestId, { company: "Synthetic", job_title: "Manager", job_description: job.jobDescription, model: payload.model });
    // Any app-side guard failure works here; switching on Sanity storage would
    // also swap this test's in-memory store.
    const saved = { vercel: process.env.VERCEL_ENV, key: process.env.TRIGGER_SECRET_KEY };
    process.env.VERCEL_ENV = "preview"; process.env.TRIGGER_SECRET_KEY = "tr_prod_synthetic";
    try {
      const result = await executeAnalysisWithFollowup(payload);
      assert.equal(result.generationErrors, undefined);
      assert.equal([...dispatched.values()].at(-1).taskId, "application-cv");
      const appSide = await reviewingGenerationResult(await create({ stage: "reviewing", fitReportId: await report() }));
      assert.match(appSide.generationErrors[0], /same content storage/);
    } finally {
      for (const [name, value] of [["VERCEL_ENV", saved.vercel], ["TRIGGER_SECRET_KEY", saved.key]])
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  await test("worker keeps completed analysis when CV dispatch fails", async () => {
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
  await test("a needs-review CV is not automatically retried", async () => {
    const job=await create({stage:'reviewing',fitReportId:await report()});
    await cvStore.claimApplicationCvRun(job,{requestId:'review-cv',fingerprint:'review-fp',status:'queued'});
    await cvStore.updateApplicationCvRun(job.id,'review-cv',{status:'needs_review'});
    const before=dispatched.size;
    await ensureReviewingGeneration(job.id);
    assert.equal(dispatched.size,before);
  });
  await test("an applied job retains its submitted CV pin and dispatches no automatic work", async () => {
    const job=await create({stage:'applied',fitReportId:await report()});
    await cvStore.claimApplicationCvRun(job,{requestId:'applied-cv',fingerprint:'applied-fp',status:'queued'});
    await cvStore.saveApplicationCvVersion(job.id,{id:'applied-cv',fingerprint:'applied-fp',sourceSnapshot:cvSource,reportSnapshot:{id:job.fitReportId,report:{job_title:'Manager'}},
      content:{identity:cvSource.identity,experience:[]},validation:{status:'valid'},pdfBuffer:Buffer.from('%PDF-1.7\napplied\n%%EOF')});
    await cvStore.publishApplicationCvVersion(job.id,'applied-cv',{expectedRequestId:'applied-cv',expectedFingerprint:'applied-fp'});
    await cvStore.markApplicationCvSubmitted(job.id);
    const before=dispatched.size;
    await ensureReviewingGeneration(job.id);
    assert.equal(dispatched.size,before);
    assert.equal((await cvStore.getApplicationCv(job.id)).submittedVersionId,'applied-cv');
  });
}));
} finally {
  tasks.trigger = originals.trigger; runs.retrieve = originals.retrieve; idempotencyKeys.create = originals.key;
}
console.log(`passed ${passed}, failed ${failed}`);
process.exitCode = failed ? 1 : 0;
