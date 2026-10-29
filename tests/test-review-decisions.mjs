process.env.ADMIN_SECRET = "review-decisions-test";
import assert from "node:assert/strict";
import { DEFAULT_REVIEW_REASONS, validateReviewReasons } from "../lib/sanity/review-reasons.js";
import { initialSettingsDocument } from "../lib/sanity/settings-document.js";
import { settingsFromDocument, withSettingsSnapshot, reviewReasonSettings, ANALYSIS_SETTINGS_QUERY } from "../lib/sanity/analysis-settings.js";
import { validateDecisionInput, decisionDirection, recordReviewDecision, listReviewDecisions, reviewReasonOptions,
  reviewDecisionRecord, setReviewDecisionClient, resetReviewDecisionsForTests } from "../lib/review-decisions.js";
import handler from "../api/admin/jobs.js";
import { saveJob, mutateJob } from "../lib/store.js";

let passed = 0, failed = 0;
async function test(name, fn) {
  resetReviewDecisionsForTests();
  setReviewDecisionClient(null);
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.error("  FAIL " + name, e); }
}

function call(method, { query = {}, body } = {}) {
  return new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; }, json(data) { resolve({ status: this.statusCode, body: data }); return this; } };
    handler({ method, query, body, headers: { "x-admin-secret": "review-decisions-test" } }, res);
  });
}
const create = extra => saveJob({ company: "Synthetic Co", role: "Engineering Manager", source: "LinkedIn direct search",
  sourceUrl: "https://www.linkedin.com/jobs/view/1", jobDescription: "Lead a team building dependable software.", ...extra });
const RECORD_ERROR = "The stage was saved, but the reason could not be recorded.";

await test("decision input is trimmed, deduped and bounded", () => {
  assert.deepEqual(validateDecisionInput(undefined), { reasons: [], note: "" });
  assert.deepEqual(validateDecisionInput(null), { reasons: [], note: "" });
  assert.deepEqual(validateDecisionInput({}), { reasons: [], note: "" });
  assert.deepEqual(validateDecisionInput({ reasons: [" Right stack ", "right stack", "Good salary"], note: "  Nice team.  " }),
    { reasons: ["Right stack", "Good salary"], note: "Nice team." });
  for (const bad of ["x", [], { reasons: "Right stack" }, { reasons: [" "] }, { reasons: [3] },
    { reasons: ["x".repeat(61)] }, { reasons: ["a", "b", "c", "d", "e", "f"] }, { note: 4 }, { note: "x".repeat(1001) }])
    assert.throws(() => validateDecisionInput(bad), error => error.status === 400 && !!error.message);
  assert.equal(validateDecisionInput({ reasons: ["x".repeat(60)], note: ` ${"y".repeat(1000)} ` }).note.length, 1000);
});

await test("stages map to advance, drop or other", () => {
  for (const stage of ["reviewing", "applied", "interviewing", "offer"]) assert.equal(decisionDirection(stage), "advance");
  assert.equal(decisionDirection("not_interested"), "drop");
  for (const stage of ["rejected", "expired"]) assert.equal(decisionDirection(stage), "other");
});

await test("records carry the job, the call and empty agent fields", async () => {
  const now = new Date("2026-10-28T09:00:00.000Z");
  const record = reviewDecisionRecord({ job: { id: "abc", company: "Acme", role: "EM", source: "JSearch · Indeed", sourceUrl: "https://acme.example/1" },
    toStage: "not_interested", decision: { reasons: ["Too hands-on"], note: "" }, score: 41, now });
  assert.deepEqual(record, { _id: `review-decision.abc.${now.getTime()}`, _type: "reviewDecision", jobId: "abc", company: "Acme", role: "EM",
    score: 41, source: "JSearch · Indeed", sourceUrl: "https://acme.example/1", fromStage: "new", toStage: "not_interested",
    direction: "drop", reasons: ["Too hands-on"], note: "", agentLean: null, agentProbability: null, decidedBy: "bernardo", overridesAgent: false, decidedAt: now.toISOString() });
  assert.equal(reviewDecisionRecord({ job: { id: "x" }, toStage: "applied" }).score, null);
});

await test("the Sanity path writes once per decision and lists newest first", async () => {
  const writes = [], fetches = [];
  setReviewDecisionClient({ createIfNotExists: async doc => { writes.push(doc); return doc; },
    fetch: async (query, params) => { fetches.push({ query, params }); return []; } });
  await recordReviewDecision({ job: { id: "s1" }, toStage: "reviewing", decision: { reasons: ["Right stack"] } });
  assert.equal(writes.length, 1);
  assert.equal(writes[0]._type, "reviewDecision");
  assert.match(writes[0]._id, /^review-decision\.s1\.\d+$/);
  await listReviewDecisions({ limit: 20 });
  assert.match(fetches[0].query, /order\(decidedAt desc\)\[0\.\.\.20\]/);
  assert.equal(fetches[0].params.type, "reviewDecision");
});

await test("quick picks append the most used past reasons, deduped case-insensitively", async () => {
  const decisions = [
    { direction: "drop", reasons: ["Fintech again", "too hands-on"] },
    { direction: "drop", reasons: ["fintech again", "Contract role"] },
    { direction: "drop", reasons: ["Fintech again", "Contract role", "Tiny team"] },
    { direction: "advance", reasons: ["Great team", "Right stack"] },
    { direction: "other", reasons: ["Closed early"] },
    { direction: "drop", reasons: ["A", "B", "C", "D"] },
  ];
  const published = settingsFromDocument(initialSettingsDocument());
  const options = await withSettingsSnapshot(published, () => reviewReasonOptions({ decisions }));
  assert.deepEqual(options.advance, [...DEFAULT_REVIEW_REASONS.advance, "Great team"]);
  assert.deepEqual(options.drop, [...DEFAULT_REVIEW_REASONS.drop, "Fintech again", "Contract role", "Tiny team", "A", "B"]);
  const unpublished = settingsFromDocument({ ...initialSettingsDocument(), reviewReasons: undefined });
  const learnedOnly = await withSettingsSnapshot(unpublished, () => reviewReasonOptions({ decisions }));
  assert.deepEqual(learnedOnly.advance, ["Great team", "Right stack"]);
  assert.equal(learnedOnly.drop[0], "Fintech again");
  assert.equal(learnedOnly.drop.length, 5);
  assert.deepEqual(await withSettingsSnapshot(unpublished, () => reviewReasonOptions({ decisions: [] })), { advance: [], drop: [] });
});

await test("review reasons validate and stay out of the scoring fingerprint", () => {
  assert.deepEqual(validateReviewReasons({ advance: [" Right stack "], drop: ["Too hands-on"] }), { advance: ["Right stack"], drop: ["Too hands-on"] });
  for (const patch of [{ advance: [] }, { drop: undefined }, { advance: Array.from({ length: 13 }, (_, i) => `R${i}`) },
    { advance: ["Same", "same"] }, { drop: [" "] }, { drop: ["x".repeat(61)] }, { drop: [7] }])
    assert.throws(() => validateReviewReasons({ ...DEFAULT_REVIEW_REASONS, ...patch }), /review reasons/);
  assert.throws(() => validateReviewReasons(null), /review reasons/);
  assert.match(ANALYSIS_SETTINGS_QUERY, /reviewReasons/);
  const doc = initialSettingsDocument();
  assert.deepEqual(doc.reviewReasons, DEFAULT_REVIEW_REASONS);
  const withReasons = settingsFromDocument(doc);
  const without = settingsFromDocument({ ...doc, reviewReasons: undefined });
  const edited = settingsFromDocument({ ...doc, reviewReasons: { advance: ["Other"], drop: ["Nope"] } });
  assert.equal(withReasons.fingerprint, without.fingerprint);
  assert.equal(withReasons.fingerprint, edited.fingerprint);
  assert.throws(() => settingsFromDocument({ ...doc, reviewReasons: { advance: [], drop: ["x"] } }), /review reasons/);
  withSettingsSnapshot(withReasons, () => assert.deepEqual(reviewReasonSettings(), DEFAULT_REVIEW_REASONS));
  withSettingsSnapshot(without, () => assert.equal(reviewReasonSettings(), null));
});

await test("GET ?reviewReasons=1 returns published and learned picks", async () => {
  await recordReviewDecision({ job: { id: "g1" }, toStage: "not_interested", decision: { reasons: ["Fintech again", "Too hands-on"] } });
  const response = await call("GET", { query: { reviewReasons: "1" } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { advance: DEFAULT_REVIEW_REASONS.advance, drop: [...DEFAULT_REVIEW_REASONS.drop, "Fintech again"] });
});

await test("leaving New records one decision with the reasons sent", async () => {
  const job = await create();
  const response = await call("PATCH", { query: { id: job.id }, body: { stage: "not_interested",
    decision: { reasons: ["Too hands-on", " too hands-on "], note: " Mostly IC work. " } } });
  assert.equal(response.status, 200);
  assert.equal(response.body.job.stage, "not_interested");
  assert.ok(!response.body.generationErrors.includes(RECORD_ERROR));
  const [decision, ...rest] = await listReviewDecisions();
  assert.equal(rest.length, 0);
  assert.equal(decision.jobId, job.id);
  assert.equal(decision.company, "Synthetic Co");
  assert.equal(decision.source, "LinkedIn direct search");
  assert.equal(decision.sourceUrl, "https://www.linkedin.com/jobs/view/1");
  assert.equal(decision.fromStage, "new"); assert.equal(decision.toStage, "not_interested"); assert.equal(decision.direction, "drop");
  assert.deepEqual(decision.reasons, ["Too hands-on"]); assert.equal(decision.note, "Mostly IC work.");
  assert.equal(decision.score, null);
});

await test("a stage change without a decision still records, with no reasons", async () => {
  const job = await create();
  await call("PATCH", { query: { id: job.id }, body: { stage: "rejected" } });
  const [decision] = await listReviewDecisions();
  assert.equal(decision.direction, "other");
  assert.deepEqual(decision.reasons, []); assert.equal(decision.note, "");
});

await test("only a move out of New is recorded", async () => {
  const job = await create();
  await call("PATCH", { query: { id: job.id }, body: { notes: "Just a note", decision: { reasons: ["Right stack"] } } });
  await call("PATCH", { query: { id: job.id }, body: { stage: "new" } });
  assert.equal((await listReviewDecisions()).length, 0);
  const later = await create({ stage: "applied" });
  await call("PATCH", { query: { id: later.id }, body: { stage: "interviewing" } });
  assert.equal((await listReviewDecisions()).length, 0);
  await call("PATCH", { query: { id: job.id }, body: { stage: "applied" } });
  await call("PATCH", { query: { id: job.id }, body: { stage: "not_interested" } });
  const decisions = await listReviewDecisions();
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].toStage, "applied"); assert.equal(decisions[0].direction, "advance");
});

await test("an invalid decision is rejected and nothing is saved", async () => {
  const job = await create();
  const response = await call("PATCH", { query: { id: job.id }, body: { stage: "not_interested", decision: { reasons: ["x".repeat(61)] } } });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /60 characters/);
  const check = await mutateJob(job.id, () => undefined);
  assert.equal(check.stage, "new");
  assert.equal((await listReviewDecisions()).length, 0);
});

await test("a recording failure keeps the stage and reports it", async () => {
  setReviewDecisionClient({ createIfNotExists: async () => { throw new Error("Sanity down"); }, fetch: async () => [] });
  const job = await create();
  const response = await call("PATCH", { query: { id: job.id }, body: { stage: "not_interested", decision: { reasons: ["Too hands-on"] } } });
  assert.equal(response.status, 200);
  assert.equal(response.body.job.stage, "not_interested");
  assert.ok(response.body.generationErrors.includes(RECORD_ERROR));
  // Moving to Reviewing replaces generationErrors with its own result; the message must survive.
  const reviewing = await create();
  const moved = await call("PATCH", { query: { id: reviewing.id }, body: { stage: "reviewing" } });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.job.stage, "reviewing");
  assert.ok(moved.body.generationErrors.includes(RECORD_ERROR));
});

console.log(`passed ${passed}, failed ${failed}`);
process.exit(failed ? 1 : 0);
