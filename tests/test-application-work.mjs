process.env.ADMIN_SECRET = "application-secret";
process.env.ANTHROPIC_API_KEY = "sk-fake";

import assert from "node:assert/strict";
import { tasks, idempotencyKeys } from "@trigger.dev/sdk";
import handler from "../api/admin/cover.js";
import * as store from "../lib/store.js";
import { withApplicationCvSource } from "../lib/application-cv-source.js";
import { createMemoryApplicationCvStore, withApplicationCvStore } from "../lib/application-cv-store.js";
import { executeApplicationWork } from "../lib/application-work.js";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (error) { failed++; console.log("  FAIL " + name + "\n" + error.stack); }
}
async function call(body) {
  const res = { code: 0, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {} };
  await handler({ method: "POST", headers: { "x-admin-secret": "application-secret" }, body }, res);
  return res;
}

const source = { fingerprint: "source-test", identity: { name: "Synthetic Candidate", headline: "Engineer", contacts: [] },
  roles: [{ id: "role-1", title: "Engineer", company: "Previous", dates: "2020–2024", location: "London", overviewEvidenceId: "e1",
    evidence: [{ id: "e1", text: "Built an accessible portal.", contribution: "personal", status: "delivered", skills: [] }] }],
  education: [], projects: [], settings: { model: "gpt-5.6-sol", prompt: "Use confirmed evidence.", minBodyPx: 13, maxWords: 300 } };
const description = "A complete engineering leadership role description.";
const originalTrigger = tasks.trigger, originalKey = idempotencyKeys.create;
const triggers = [];
tasks.trigger = async (taskId, payload) => { triggers.push({ taskId, payload }); return { id: "run-" + triggers.length }; };
idempotencyKeys.create = async (key) => key;
const cvStore = createMemoryApplicationCvStore();

try {
  await withApplicationCvStore(cvStore, () => withApplicationCvSource(source, async () => {
    await test("one reviewed application dispatches a single run with shared instructions", async () => {
      const job = await store.saveJob({ company: "Combined", role: "EM", jobDescription: description });
      const review = (await call({ action: "review", kind: "application", id: job.id, versionInstructions: "Lead with platform work." })).body.review;
      assert.equal(review.effectiveKind, "application");
      assert.equal(review.submitLabel, "Generate application");
      const res = await call({ kind: "application", id: job.id, versionInstructions: "Lead with platform work.",
        reviewFingerprint: review.fingerprint, requestId: "application0001" });
      assert.equal(res.code, 202);
      const sent = triggers.at(-1);
      assert.equal(sent.taskId, "application-package");
      assert.equal(sent.payload.mode, "create");
      assert.equal(sent.payload.versionInstructions, "Lead with platform work.");
      assert.equal((await store.getJob(job.id)).applicationRun.status, "queued");
    });

    await test("the CV is written from the analysis the same run produced", async () => {
      const job = await store.saveJob({ company: "Linked", role: "EM", jobDescription: description });
      const review = (await call({ action: "review", kind: "application", id: job.id, versionInstructions: "Mention accessibility." })).body.review;
      await call({ kind: "application", id: job.id, versionInstructions: "Mention accessibility.",
        reviewFingerprint: review.fingerprint, requestId: "application0002" });
      const payload = { ...triggers.at(-1).payload };
      let analysisInput, cvInput;
      const result = await executeApplicationWork(payload, {
        runId: "parent-run",
        runAnalysis: async (input) => {
          analysisInput = input;
          assert.equal((await store.getJob(job.id)).analysisRun.requestId, input.requestId);
          const reportId = await store.saveReport({ company: "Linked", job_title: "EM", job_description: description });
          await store.updateJob(job.id, { fitReportId: reportId });
          return { outcome: "completed", reportId };
        },
        runCv: async (input) => {
          cvInput = input;
          const claimed = await cvStore.getApplicationCv(job.id);
          assert.equal(claimed.run.requestId, input.requestId);
          return { outcome: "completed", publication: "published", versionId: input.requestId };
        },
      });
      assert.equal(result.outcome, "completed");
      assert.equal(analysisInput.versionInstructions, "Mention accessibility.");
      assert.equal(cvInput.versionInstructions, "Mention accessibility.");
      assert.equal(cvInput.reportSnapshot.id, (await store.getJob(job.id)).fitReportId);
      assert.equal(cvInput.origin, payload.origin);
      assert.equal((await store.getJob(job.id)).applicationRun.status, "completed");
    });

    await test("a superseded analysis stops before the CV", async () => {
      const job = await store.saveJob({ company: "Stopped", role: "EM", jobDescription: description });
      const review = (await call({ action: "review", kind: "application", id: job.id })).body.review;
      await call({ kind: "application", id: job.id, reviewFingerprint: review.fingerprint, requestId: "application0003" });
      let cvCalls = 0;
      const result = await executeApplicationWork(triggers.at(-1).payload, {
        runAnalysis: async () => ({ outcome: "superseded" }), runCv: async () => { cvCalls++; },
      });
      assert.equal(result.outcome, "superseded");
      assert.equal(cvCalls, 0);
      assert.equal((await store.getJob(job.id)).applicationRun.status, "superseded");
    });
  }));
} finally {
  tasks.trigger = originalTrigger; idempotencyKeys.create = originalKey;
}
console.log(`passed ${passed}, failed ${failed}`); process.exitCode = failed ? 1 : 0;
