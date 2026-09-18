process.env.ADMIN_SECRET = "review-secret";
process.env.ANTHROPIC_API_KEY = "sk-fake";

import assert from "node:assert/strict";
import { tasks, idempotencyKeys } from "@trigger.dev/sdk";
import handler from "../api/admin/cover.js";
import { resolveGenerationReview } from "../lib/generation-review.js";
import { researchFingerprint } from "../lib/generation-fingerprint.js";
import { saveScreenArtifact } from "../lib/screen-artifacts.js";
import * as store from "../lib/store.js";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (error) { failed++; console.log("  FAIL " + name + "\n" + error.stack); }
}
function response() {
  return { code: 0, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {} };
}
async function call(body) {
  const res = response();
  await handler({ method: "POST", headers: { "x-admin-secret": "review-secret" }, body }, res);
  return res;
}

const originalTrigger = tasks.trigger;
const originalKey = idempotencyKeys.create;
let triggers = [];
tasks.trigger = async (taskId, payload) => { triggers.push({ taskId, payload }); return { id: "run-" + triggers.length }; };
idempotencyKeys.create = async (key) => key;

try {
  await test("review is read-only and resolves an allowed model", async () => {
    const job = await store.saveJob({ company: "Review", role: "EM", jobDescription: "A complete engineering leadership role description." });
    const res = await call({ action: "review", kind: "analyse", id: job.id, model: "not-a-model" });
    assert.equal(res.code, 200);
    assert.equal(res.body.review.model, "gpt-5.6-sol");
    assert.equal(triggers.length, 0);
    assert.equal((await store.getJob(job.id)).analysisRun == null, true);
  });

  await test("generation without a reviewed fingerprint is rejected", async () => {
    const job = await store.saveJob({ company: "No review", role: "EM", jobDescription: "A complete engineering leadership role description." });
    const res = await call({ kind: "analyse", id: job.id, model: "gpt-5.6-sol", requestId: "missingreview01" });
    assert.equal(res.code, 409);
    assert.equal(res.body.code, "REVIEW_STALE");
    assert.equal(triggers.length, 0);
  });

  await test("reviewed submit dispatches exactly once", async () => {
    const job = await store.saveJob({ company: "Submit", role: "EM", jobDescription: "A complete engineering leadership role description." });
    const review = (await call({ action: "review", kind: "analyse", id: job.id, model: "gpt-5.6-sol" })).body.review;
    const before = triggers.length;
    const res = await call({ kind: review.effectiveKind, id: job.id, model: review.model,
      reviewFingerprint: review.fingerprint, requestId: "reviewedsubmit01" });
    assert.equal(res.code, 202);
    assert.equal(triggers.length, before + 1);
    assert.equal(triggers.at(-1).taskId, "fit-analysis");
  });

  await test("changed inputs stop submission before dispatch", async () => {
    const job = await store.saveJob({ company: "Changed", role: "EM", jobDescription: "A complete engineering leadership role description." });
    const review = await resolveGenerationReview({ kind: "analyse", id: job.id, model: "gpt-5.6-sol" });
    await store.updateJob(job.id, { instructions: "Use a different angle." });
    const before = triggers.length;
    const res = await call({ kind: "analyse", id: job.id, model: "gpt-5.6-sol",
      reviewFingerprint: review.fingerprint, requestId: "changedinputs01" });
    assert.equal(res.code, 409);
    assert.equal(res.body.code, "REVIEW_STALE");
    assert.equal(triggers.length, before);
  });

  await test("bulk scope is exact and newly eligible roles require a new review", async () => {
    await store.saveJob({ company: "Bulk one", role: "EM", jobDescription: "A complete engineering leadership role description." });
    const review = (await call({ action: "review", kind: "analyse-all", model: "gpt-5.6-sol" })).body.review;
    await store.saveJob({ company: "Bulk later", role: "EM", jobDescription: "Another complete engineering leadership role description." });
    const before = triggers.length;
    const res = await call({ kind: "analyse-all", model: review.model, reviewFingerprint: review.fingerprint, requestId: "bulkscope001" });
    assert.equal(res.code, 409);
    assert.equal(triggers.length, before);
  });

  await test("brief review uses selected-model research reuse truth", async () => {
    const reportId = await store.saveReport({ company: "Model", job_title: "EM", job_description: "JD", pitch: "p", categories: [], differentiators: [] });
    let job = await store.saveJob({ company: "Model", role: "EM", jobDescription: "JD", fitReportId: reportId });
    await saveScreenArtifact("research", job.id, "research-model", { at: new Date().toISOString(), model: "claude-sonnet-5", sources: [] });
    await store.updateJob(job.id, { researchId: "research-model", researchAt: new Date().toISOString(), researchModel: "claude-sonnet-5",
      researchFingerprint: researchFingerprint(job) });
    const same = await resolveGenerationReview({ kind: "prepare-screen", id: job.id, model: "claude-sonnet-5" });
    const different = await resolveGenerationReview({ kind: "prepare-screen", id: job.id, model: "claude-opus-5" });
    assert.equal(same.kind, "brief");
    assert.equal(same.review.researchAction, "reuse");
    assert.equal(different.kind, "prepare-screen");
    assert.equal(different.review.researchAction, "refresh");
  });
} finally {
  tasks.trigger = originalTrigger;
  idempotencyKeys.create = originalKey;
}

console.log("\npassed " + passed + ", failed " + failed);
process.exit(failed ? 1 : 0);
