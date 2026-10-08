import assert from "node:assert/strict";
import { filteredJobRecord, recordFilteredJob, listFilteredJobs, moveFilteredJob, purgeFilteredJobs,
  resetFilteredJobsForTests, filteredJobDocumentId } from "../lib/filtered-jobs.js";
import { executeIngestBatch, ingestIdentity } from "../lib/ingest-work.js";
import { discoverLinkedIn, cardOpportunity } from "../lib/linkedin-discovery.js";
import { getJob, listJobs } from "../lib/store.js";
import { settingsFromDocument } from "../lib/sanity/analysis-settings.js";
import { initialSettingsDocument } from "../lib/sanity/settings-document.js";
import handler from "../api/admin/jobs.js";

process.env.ADMIN_SECRET = "synthetic-admin";
let passed = 0, failed = 0;
async function test(name, fn) {
  resetFilteredJobsForTests();
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.error("  FAIL " + name, e); }
}

const assessment = (score, extra = {}) => ({ status: "complete", score, blocked: false, provisional: false, assessedAt: "2026-10-08T08:00:00.000Z",
  fingerprint: "synthetic", posting: { choice: "complete", probabilities: { complete: 1 } },
  constraint: { choice: "clear", probabilities: { clear: 1, conflict: 0 } },
  dimensions: [
    { id: "responsibilities", label: "Responsibilities", weight: 30, score: 40 },
    { id: "evidence", label: "Capability", weight: 30, score: 55 },
    { id: "practical", label: "Compatibility", weight: 20, score: 20 },
  ], ...extra });
const opportunity = (id, extra = {}) => ({ externalId: `linkedin-${id}`, company: `Company ${id}`, role: "Engineering Manager",
  sourceUrl: `https://www.linkedin.com/jobs/view/${id}`, location: "Leeds", source: "LinkedIn direct search",
  jobDescription: "A synthetic engineering leadership role.", ...extra });

function call(method, { query = {}, body } = {}) {
  return new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; }, json(data) { resolve({ status: this.statusCode, body: data }); return this; } };
    handler({ method, query, body, headers: { "x-admin-secret": "synthetic-admin" } }, res);
  });
}

await test("records keep a factual reason, scores and the pipeline identity", () => {
  const record = filteredJobRecord({ opportunity: opportunity("101"), decision: "below-threshold", assessment: assessment(42), minimumScore: 50 });
  assert.equal(record.identity, ingestIdentity(opportunity("101")));
  assert.equal(record._id, filteredJobDocumentId(record.identity));
  assert.equal(record.reason, "Scored 42, below the admission threshold of 50. Weakest: Compatibility and Responsibilities.");
  assert.equal(record.score, 42); assert.equal(record.hasDescription, true);
  assert.equal(record.dimensions.length, 3);
  assert.deepEqual(JSON.parse(record.assessment).score, 42);
  const title = filteredJobRecord({ opportunity: cardOpportunity({ id: "102", company: "Acme", role: "Sales Manager",
    sourceUrl: "https://www.linkedin.com/jobs/view/102", postedDate: "2026-10-07" }), decision: "title-mismatch", relevanceProbability: 0.13 });
  assert.match(title.reason, /title screen.*13% relevant/);
  assert.equal(title.score, null); assert.equal(title.hasDescription, false); assert.equal(title.postedDate, "2026-10-07");
  assert.equal(title.identity, ingestIdentity({ externalId: "linkedin-102", sourceUrl: "https://www.linkedin.com/jobs/view/102" }));
  const blocked = filteredJobRecord({ opportunity: opportunity("103"), decision: "constraint-conflict",
    assessment: assessment(61, { blocked: true, constraint: { choice: "conflict", probabilities: { conflict: 0.93 } } }) });
  assert.equal(blocked.reason, "Conflicts with a hard constraint (93% certain). Fit score 61.");
  assert.throws(() => filteredJobRecord({ opportunity: opportunity("104"), decision: "evaluation-failed" }));
});

await test("ingest records analysed rejections but not failed evaluations", async () => {
  const screens = { "linkedin-201": { decision: "below-threshold", assessment: assessment(44) },
    "linkedin-202": { decision: "evaluation-failed", assessment: null, error: "Retry" },
    "linkedin-203": { decision: "constraint-conflict", assessment: assessment(70, { blocked: true }) } };
  const result = await executeIngestBatch(["201", "202", "203"].map(id => opportunity(id)),
    { minimumScore: 50, screen: async opp => screens[opp.externalId] });
  assert.equal(result.filtered, 2); assert.equal(result.failed, 1); assert.equal(result.filteredRecorded, 2);
  const list = await listFilteredJobs();
  assert.deepEqual(list.map(f => f.company).sort(), ["Company 201", "Company 203"]);
  assert.equal(list.find(f => f.company === "Company 201").minimumScore, 50);
});

await test("a storage failure is reported without failing the batch", async () => {
  const result = await executeIngestBatch([opportunity("251")], { minimumScore: 50,
    screen: async () => ({ decision: "below-threshold", assessment: assessment(30) }),
    recordFiltered: async entries => ({ recorded: 0, failures: entries.map(() => ({ reason: "down" })) }) });
  assert.equal(result.filtered, 1); assert.equal(result.filteredRecordFailures.length, 1);
});

await test("discovery keeps title-screened cards with their relevance", async () => {
  const recorded = [];
  const posting = id => ({ id, company: `Card ${id}`, role: id === "301" ? "Sales Director" : "Engineering Manager",
    location: "London", sourceUrl: `https://www.linkedin.com/jobs/view/${id}` });
  const report = await discoverLinkedIn({ now: new Date("2026-10-08T08:00:00Z"), list: async () => [],
    search: async () => ({ jobs: [posting("301"), posting("302")], scans: [], complete: true }),
    prescreen: async p => p.id === "301" ? { decision: "skip", relevanceProbability: 0.04 } : { decision: "fetch", relevanceProbability: 0.98 },
    describe: async p => ({ ...opportunity(p.id), company: p.company }),
    ingest: async (batch, options) => { assert.equal(typeof options.recordFiltered, "function");
      return { filtered: 1, screeningRows: [], addedRows: [], filteredRecorded: 1, filteredRecordFailures: [] }; },
    recordFiltered: async entries => { recorded.push(...entries); return { recorded: entries.length, failures: [] }; },
    purgeFiltered: async () => ({ removed: 3 }) });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].decision, "title-mismatch");
  assert.equal(recorded[0].relevanceProbability, 0.04);
  assert.equal(recorded[0].opportunity.externalId, "linkedin-301");
  assert.equal(report.filteredRecorded, 2); assert.equal(report.filteredPurged, 3);
  assert.equal(report.complete, true);
});

await test("moving creates the job at New with its saved assessment and hides the record", async () => {
  await recordFilteredJob({ opportunity: opportunity("401"), decision: "below-threshold", assessment: assessment(47), minimumScore: 50 });
  const [item] = await listFilteredJobs();
  const job = await moveFilteredJob(item.id);
  assert.equal(job.id, item.id); assert.equal(job.stage, "new");
  assert.equal(job.jevAssessment.score, 47);
  assert.equal(job.jobDescription, "A synthetic engineering leadership role.");
  assert.equal((await getJob(item.id)).company, "Company 401");
  assert.equal((await listFilteredJobs()).length, 0);
  // A repeat move returns the same job rather than creating another.
  assert.equal((await moveFilteredJob(item.id)).id, job.id);
  assert.equal((await listJobs()).filter(j => j.company === "Company 401").length, 1);
  // Seeing the posting again does not bring a moved record back.
  await recordFilteredJob({ opportunity: opportunity("401"), decision: "below-threshold", assessment: assessment(47), minimumScore: 50 });
  assert.equal((await listFilteredJobs()).length, 0);
});

await test("title-screened jobs move without a description or score", async () => {
  await recordFilteredJob({ opportunity: cardOpportunity({ id: "501", company: "Acme", role: "Head of Platform",
    sourceUrl: "https://www.linkedin.com/jobs/view/501" }), decision: "title-mismatch", relevanceProbability: 0.2 });
  const [item] = await listFilteredJobs();
  const job = await moveFilteredJob(item.id);
  assert.equal(job.stage, "new"); assert.equal(job.jevAssessment, null); assert.equal(job.jobDescription, "");
  assert.equal(job.sourceUrl, "https://www.linkedin.com/jobs/view/501");
  await assert.rejects(moveFilteredJob("ing_00000000000000000000"), { status: 404 });
  await assert.rejects(moveFilteredJob("../not-an-id"), { status: 404 });
});

await test("retention removes records older than the published period only", async () => {
  await recordFilteredJob({ opportunity: opportunity("601"), decision: "below-threshold", assessment: assessment(10), now: new Date("2026-06-01T00:00:00Z") });
  await recordFilteredJob({ opportunity: opportunity("602"), decision: "below-threshold", assessment: assessment(10), now: new Date("2026-10-01T00:00:00Z") });
  assert.deepEqual(await purgeFilteredJobs({ now: new Date("2026-10-08T00:00:00Z"), days: null }), { removed: 0, skipped: "no published retention" });
  assert.equal((await purgeFilteredJobs({ now: new Date("2026-10-08T00:00:00Z"), days: 90 })).removed, 1);
  assert.deepEqual((await listFilteredJobs()).map(f => f.company), ["Company 602"]);
});

await test("retention is published policy, never a silent default", () => {
  const doc = initialSettingsDocument();
  assert.equal(settingsFromDocument(doc).filteredJobRetentionDays, 90);
  const missing = structuredClone(doc); delete missing.filteredJobRetentionDays;
  assert.equal(settingsFromDocument(missing).filteredJobRetentionDays, null);
  for (const value of [0, 6, 366, 30.5, "90"])
    assert.throws(() => settingsFromDocument({ ...doc, filteredJobRetentionDays: value }), { code: "SANITY_SETTINGS_INVALID" });
  assert.equal(settingsFromDocument({ ...doc, filteredJobRetentionDays: 30 }).fingerprint, settingsFromDocument(doc).fingerprint);
});

await test("admin API lists filtered roles and moves one into the pipeline", async () => {
  await recordFilteredJob({ opportunity: opportunity("701"), decision: "below-threshold", assessment: assessment(48), minimumScore: 50 });
  const listed = await call("GET", { query: { filtered: "1" } });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.filtered.length, 1);
  const [item] = listed.body.filtered;
  assert.equal(item.score, 48); assert.equal(item.decision, "below-threshold");
  assert.equal(item.opportunity, undefined, "full saved posting stays server-side in the list");
  const moved = await call("POST", { body: { action: "move-filtered", id: item.id } });
  assert.equal(moved.status, 200); assert.equal(moved.body.job.stage, "new"); assert.equal(moved.body.job.score, 48);
  assert.equal((await call("GET", { query: { filtered: "1" } })).body.filtered.length, 0);
  assert.equal((await call("POST", { body: { action: "move-filtered" } })).status, 400);
});

console.log(`passed ${passed}, failed ${failed}`);
if (failed) process.exit(1);
