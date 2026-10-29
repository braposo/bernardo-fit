process.env.ADMIN_SECRET = "auto-advance-test";
import assert from "node:assert/strict";
import { tasks, runs, idempotencyKeys } from "@trigger.dev/sdk";
import { DEFAULT_REVIEW_AGENT, validateReviewAgent } from "../lib/sanity/review-agent-settings.js";
import { initialSettingsDocument } from "../lib/sanity/settings-document.js";
import { settingsFromDocument, withSettingsSnapshot } from "../lib/sanity/analysis-settings.js";
import { executeJobReview, autoMoveJob, autoMoveGate, autoMoveStage, agreementStats, selectExamples, assessmentKey,
  REVIEW_POLICY, AUTO_AGREEMENT_WINDOW } from "../lib/review-agent.js";
import { listReviewDecisions, recordReviewDecision, reviewReasonOptions, resetReviewDecisionsForTests, setReviewDecisionClient } from "../lib/review-decisions.js";
import { updateJobFromBody, agentMoveOverride } from "../lib/job-update.js";
import { getJobAudit } from "../lib/job-audit.js";
import { jobSummary } from "../lib/job-view.js";
import { saveJob, getJob, mutateJob } from "../lib/store.js";
import handler from "../api/admin/jobs.js";

let passed = 0, failed = 0;
async function test(name, fn) {
  resetReviewDecisionsForTests();
  setReviewDecisionClient(null);
  dispatched.length = 0;
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.error("  FAIL " + name, e); }
}
// No live Trigger or network calls: Reviewing generation dispatches are recorded.
const dispatched = [];
tasks.trigger = async (taskId, payload) => { dispatched.push({ taskId, payload }); return { id: `run-${dispatched.length}` }; };
runs.retrieve = async id => ({ id, status: "EXECUTING" });
idempotencyKeys.create = async key => key;
globalThis.fetch = async url => { throw new Error(`No network in tests: ${url}`); };

function call(method, { query = {}, body } = {}) {
  return new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; }, json(data) { resolve({ status: this.statusCode, body: data }); return this; } };
    handler({ method, query, body, headers: { "x-admin-secret": "auto-advance-test" } }, res);
  });
}

const agentSettings = extra => ({ ...DEFAULT_REVIEW_AGENT, enabled: true, ...extra });
const snapshot = extra => settingsFromDocument({ ...initialSettingsDocument(), reviewAgent: agentSettings(extra) });
const assessment = (extra = {}) => ({ model: "jev-1.13.0", policy: "synthetic", fingerprint: "fp-1", assessedAt: "2026-10-28T08:00:00.000Z",
  score: 72, dimensions: [{ id: "responsibilities", label: "Responsibilities", weight: 100, score: 72, confidence: 0.8, probabilities: {} }],
  posting: { type: "choice", choice: "complete", probabilities: { complete: 0.95, partial: 0.05, inaccessible: 0, unrelated: 0 } },
  constraint: { type: "choice", choice: "clear", probabilities: { conflict: 0.05, clear: 0.9, unknown: 0.05 } },
  blocked: false, provisional: false, status: "complete", ...extra });
const create = extra => saveJob({ company: "Synthetic Co", role: "Engineering Manager", location: "Remote UK",
  jobDescription: "Lead a team building dependable software.", jevAssessment: assessment(), ...extra });
const answers = (advance, drop) => async () => ({ answers: { advance: { type: "boolean", probability: advance }, drop: { type: "boolean", probability: drop } }, model: "jev-1.13.0" });
const note = async () => ({ reason: "Remote UK lead of eight engineers, like roles he moved forward.", question: "", model: "gpt-6.1-sol" });
const noRules = async () => [];
const review = (lean, extra = {}) => ({ lean, advanceProbability: lean === "advance" ? 0.9 : 0.05, dropProbability: lean === "drop" ? 0.9 : 0.05,
  reason: `Reason for ${lean}.`, question: "", reviewedAt: "2026-10-28T09:00:00.000Z", model: "jev-1.13.0", examples: 0,
  assessment: assessmentKey(assessment()), policy: REVIEW_POLICY, ...extra });
// Bernardo's past calls on confident suggestions: agreed of them matched.
async function history(count, agreed = count, { start = Date.parse("2026-10-01T00:00:00Z") } = {}) {
  for (let i = 0; i < count; i++) await recordReviewDecision({ job: { id: `past-${i}`, company: "Past", role: "Engineering Manager", agentReview: review("advance") },
    toStage: i < agreed ? "reviewing" : "not_interested", decision: { reasons: ["Right stack"] }, now: new Date(start + i * 60000) });
}

await test("settings: the gates and learnPreferences are optional, validated and seeded closed or off", () => {
  assert.equal(DEFAULT_REVIEW_AGENT.autoAdvance, false); assert.equal(DEFAULT_REVIEW_AGENT.autoDrop, false);
  assert.equal(DEFAULT_REVIEW_AGENT.learnPreferences, false);
  const { autoMinimumAgreement, autoMinimumDecided, learnPreferences, ...older } = DEFAULT_REVIEW_AGENT;
  // Settings published before these fields existed still load, with the gate closed.
  assert.deepEqual(validateReviewAgent(older), { ...older, autoMinimumAgreement: null, autoMinimumDecided: null, learnPreferences: false });
  assert.equal(autoMoveGate([], validateReviewAgent({ ...older, autoAdvance: true })).open, false);
  for (const patch of [{ autoMinimumAgreement: 0.49 }, { autoMinimumAgreement: 1.01 }, { autoMinimumAgreement: "0.9" }, { autoMinimumDecided: 4 },
    { autoMinimumDecided: 101 }, { autoMinimumDecided: 20.5 }, { learnPreferences: "yes" }])
    assert.throws(() => validateReviewAgent({ ...DEFAULT_REVIEW_AGENT, ...patch }), /review agent settings/);
  assert.equal(validateReviewAgent({ ...DEFAULT_REVIEW_AGENT, autoMinimumAgreement: 1, autoMinimumDecided: 100 }).autoMinimumDecided, 100);
  assert.equal(autoMoveStage("advance", { autoAdvance: true }), "reviewing");
  assert.equal(autoMoveStage("drop", { autoDrop: true }), "not_interested");
  assert.equal(autoMoveStage("advance", { autoDrop: true }), null);
  assert.equal(autoMoveStage("ask", { autoAdvance: true, autoDrop: true }), null);
});

await test("with the switches off a confident review never moves the job", async () => {
  await history(30);
  const job = await create();
  const moves = [];
  const result = await withSettingsSnapshot(snapshot(), () => executeJobReview({ jobId: job.id },
    { evaluate: answers(0.95, 0.01), write: note, loadRules: noRules, move: async (...args) => { moves.push(args); return { status: 200 }; } }));
  assert.equal(result.outcome, "reviewed"); assert.equal(result.lean, "advance"); assert.equal(result.autoMove, "off");
  assert.deepEqual(moves, []);
  assert.equal((await getJob(job.id)).stage, "new");
  // autoDrop alone does not move an advance.
  const other = await create();
  assert.equal((await withSettingsSnapshot(snapshot({ autoDrop: true }), () => executeJobReview({ jobId: other.id },
    { evaluate: answers(0.95, 0.01), write: note, loadRules: noRules }))).autoMove, "off");
  assert.equal((await getJob(other.id)).stage, "new");
});

await test("the agreement gate keeps the agent in shadow mode until it is met", async () => {
  const s = agentSettings({ autoAdvance: true });
  assert.deepEqual(autoMoveGate([], s), { open: false, decided: 0, agreed: 0, rate: null });
  await history(19);
  assert.equal(autoMoveGate(await listReviewDecisions({ limit: 500 }), s).open, false);
  await history(20, 16, { start: Date.parse("2026-10-10T00:00:00Z") });
  // 16 of the latest 20 agreed (0.8 < 0.85), even with older agreements behind them.
  const gate = autoMoveGate((await listReviewDecisions({ limit: 500 })).slice(0, 20), s);
  assert.deepEqual(gate, { open: false, decided: 20, agreed: 16, rate: 0.8 });
  assert.equal(autoMoveGate(await listReviewDecisions({ limit: 500 }), s).open, true, "35 of 39 agreed");
  assert.equal(autoMoveGate(await listReviewDecisions({ limit: 500 }), { ...s, autoMinimumAgreement: null }).open, false);
  assert.equal(autoMoveGate(await listReviewDecisions({ limit: 500 }), { ...s, autoMinimumDecided: 40 }).open, false);
  // Only the latest window counts.
  const many = Array.from({ length: AUTO_AGREEMENT_WINDOW + 50 }, (_, i) => ({ agentLean: "advance", direction: i < AUTO_AGREEMENT_WINDOW ? "advance" : "drop" }));
  assert.deepEqual(autoMoveGate(many, s), { open: true, decided: AUTO_AGREEMENT_WINDOW, agreed: AUTO_AGREEMENT_WINDOW, rate: 1 });
  // A gated review stays a suggestion.
  const job = await create();
  const result = await withSettingsSnapshot(snapshot({ autoAdvance: true, autoMinimumDecided: 50 }), () => executeJobReview({ jobId: job.id },
    { evaluate: answers(0.95, 0.01), write: note, loadRules: noRules }));
  assert.equal(result.autoMove, "gated"); assert.equal(result.agreement.decided, 39);
  assert.equal((await getJob(job.id)).stage, "new");
});

await test("auto-advance moves the job like a manual move, recorded as the agent's", async () => {
  await history(25);
  const job = await create({ company: "Forward Co" });
  const result = await withSettingsSnapshot(snapshot({ autoAdvance: true }), () => executeJobReview({ jobId: job.id },
    { evaluate: answers(0.95, 0.01), write: note, loadRules: noRules, now: new Date("2026-10-29T10:00:00Z") }));
  assert.equal(result.outcome, "reviewed"); assert.equal(result.autoMove, "moved"); assert.equal(result.stage, "reviewing");
  const saved = await getJob(job.id);
  assert.equal(saved.stage, "reviewing"); assert.equal(saved.archived, false);
  assert.deepEqual(saved.agentReview.autoMove, { stage: "reviewing", at: "2026-10-29T10:00:00.000Z" });
  assert.deepEqual(jobSummary(saved).agentReview.autoMove, { stage: "reviewing", at: "2026-10-29T10:00:00.000Z", overriddenAt: "" });
  // Reviewing generation started, as for a manual move.
  assert.deepEqual(dispatched.map(d => d.payload.jobId), [job.id]);
  const { events } = await getJobAudit(saved);
  const moved = events.find(e => e.type === "agent.moved");
  assert.equal(moved.actor, "agent"); assert.equal(moved.detail, "new → reviewing");
  assert.ok(events.some(e => e.type === "status.changed"));
  const [decision] = await listReviewDecisions({ limit: 1 });
  assert.equal(decision.jobId, job.id); assert.equal(decision.decidedBy, "agent"); assert.equal(decision.direction, "advance");
  assert.equal(decision.agentLean, "advance"); assert.equal(decision.note, "Remote UK lead of eight engineers, like roles he moved forward.");
  // The agent's own call never counts as agreement or as an example.
  const all = await listReviewDecisions({ limit: 500 });
  assert.deepEqual(agreementStats(all), agreementStats(all.filter(d => d.decidedBy !== "agent")));
  assert.equal(agreementStats(all).decided, 25);
  assert.ok(!selectExamples({ company: "Forward Co", role: "Engineering Manager", jevAssessment: { score: 72 } }, all, 10).some(d => d.jobId === job.id));
});

await test("auto-drop archives the job at Not interested with the agent's reason; Archive restores it as a disagreement", async () => {
  await history(25);
  const job = await create({ company: "Drop Co" });
  const result = await withSettingsSnapshot(snapshot({ autoDrop: true }), () => executeJobReview({ jobId: job.id },
    { evaluate: answers(0.02, 0.93), write: async () => ({ reason: "Five office days in Leeds.", question: "", model: "m" }), loadRules: noRules }));
  assert.equal(result.autoMove, "moved"); assert.equal(result.stage, "not_interested");
  let saved = await getJob(job.id);
  assert.equal(saved.stage, "not_interested"); assert.equal(saved.archived, true);
  const [decision] = await listReviewDecisions({ limit: 1 });
  assert.equal(decision.decidedBy, "agent"); assert.equal(decision.direction, "drop"); assert.equal(decision.note, "Five office days in Leeds.");
  assert.equal(agreementStats(await listReviewDecisions({ limit: 500 })).decided, 25);
  // Restore from Archive, as today.
  const restored = await call("PATCH", { query: { id: job.id }, body: { archived: false } });
  assert.equal(restored.status, 200);
  saved = await getJob(job.id);
  assert.equal(saved.archived, false); assert.ok(saved.agentReview.autoMove.overriddenAt);
  const [override] = await listReviewDecisions({ limit: 1 });
  assert.equal(override.jobId, job.id); assert.equal(override.decidedBy, "bernardo"); assert.equal(override.overridesAgent, true);
  assert.equal(override.agentLean, "drop"); assert.equal(override.direction, "drop");
  assert.deepEqual(agreementStats(await listReviewDecisions({ limit: 500 })), { decided: 26, agreed: 25, rate: 0.96 });
  const { events } = await getJobAudit(saved);
  assert.equal(events.find(e => e.type === "agent.overridden").actor, "admin");
  // Recorded once: a further move is not a second disagreement.
  await call("PATCH", { query: { id: job.id }, body: { stage: "reviewing" } });
  assert.equal((await listReviewDecisions({ limit: 500 })).filter(d => d.jobId === job.id).length, 2);
});

await test("moving an auto-advanced job back to New is a disagreement; his later call carries no lean", async () => {
  const job = await create({ stage: "reviewing", agentReview: review("advance", { autoMove: { stage: "reviewing", at: "2026-10-29T10:00:00.000Z" } }) });
  assert.deepEqual(agentMoveOverride(await getJob(job.id), { stage: "applied" }), null, "same direction is agreement");
  assert.deepEqual(agentMoveOverride(await getJob(job.id), { notes: "x" }), null);
  assert.deepEqual(agentMoveOverride(await getJob(job.id), { stage: "new" }), { fromStage: "reviewing", toStage: "new" });
  const back = await call("PATCH", { query: { id: job.id }, body: { stage: "new" } });
  assert.equal(back.status, 200);
  let decisions = await listReviewDecisions();
  assert.equal(decisions.length, 1);
  assert.deepEqual([decisions[0].fromStage, decisions[0].toStage, decisions[0].direction, decisions[0].overridesAgent, decisions[0].agentLean],
    ["reviewing", "new", "other", true, "advance"]);
  assert.deepEqual(agreementStats(decisions), { decided: 1, agreed: 0, rate: 0 });
  // Back at New the agent does not move it again, and his next call is not scored twice.
  const result = await withSettingsSnapshot(snapshot({ autoAdvance: true, autoMinimumDecided: 5, autoMinimumAgreement: 0.5 }), () =>
    executeJobReview({ jobId: job.id }, { evaluate: async () => { throw new Error("no Jev call"); }, loadRules: noRules }));
  assert.equal(result.outcome, "already-reviewed"); assert.equal(result.autoMove, "off");
  await call("PATCH", { query: { id: job.id }, body: { stage: "not_interested", decision: { reasons: ["Too hands-on"] } } });
  decisions = await listReviewDecisions();
  assert.equal(decisions.length, 2); assert.equal(decisions[0].agentLean, null); assert.equal(decisions[0].decidedBy, "bernardo");
  assert.deepEqual(agreementStats(decisions), { decided: 1, agreed: 0, rate: 0 });
  // His reasons still teach the agent.
  assert.ok((await reviewReasonOptions({ decisions })).drop.includes("Too hands-on"));
});

await test("automatic moves are idempotent and only happen at New on the same assessment", async () => {
  await history(25);
  const s = snapshot({ autoAdvance: true });
  const job = await create();
  // The move failed after the review was saved: the task's retry makes it, once.
  let failing = true;
  const flaky = async (...args) => { if (failing) { failing = false; throw new Error("storage blip"); } return updateJobFromBody(...args); };
  await assert.rejects(withSettingsSnapshot(s, () => executeJobReview({ jobId: job.id }, { evaluate: answers(0.95, 0.01), write: note, loadRules: noRules, move: flaky })), /storage blip/);
  assert.equal((await getJob(job.id)).stage, "new");
  const retry = await withSettingsSnapshot(s, () => executeJobReview({ jobId: job.id }, { evaluate: async () => { throw new Error("no Jev call"); }, loadRules: noRules, move: flaky }));
  assert.equal(retry.outcome, "already-reviewed"); assert.equal(retry.autoMove, "moved");
  assert.equal((await getJob(job.id)).stage, "reviewing");
  assert.equal((await withSettingsSnapshot(s, () => executeJobReview({ jobId: job.id }, { loadRules: noRules }))).outcome, "not-new");
  // A second move with the same review is refused by the guard.
  const again = await withSettingsSnapshot(s, () => autoMoveJob({ jobId: job.id, key: assessmentKey(assessment()), review: review("advance"),
    settings: agentSettings({ autoAdvance: true }), decisions: () => listReviewDecisions({ limit: 500 }) }));
  assert.equal(again.autoMove, "superseded");
  assert.equal((await listReviewDecisions({ limit: 500 })).filter(d => d.jobId === job.id).length, 1);
  // Bernardo moved it (or it was re-assessed) between the review and the move: nothing happens.
  for (const change of [{ stage: "applied" }, { jevAssessment: assessment({ assessedAt: "2026-10-29T08:00:00.000Z" }) }]) {
    const other = await create();
    const racing = async (...args) => { await mutateJob(other.id, () => change); return updateJobFromBody(...args); };
    const result = await withSettingsSnapshot(s, () => executeJobReview({ jobId: other.id }, { evaluate: answers(0.95, 0.01), write: note, loadRules: noRules, move: racing }));
    assert.equal(result.autoMove, "superseded");
    const saved = await getJob(other.id);
    assert.equal(saved.agentReview.autoMove, undefined);
    assert.equal(saved.stage, change.stage || "new");
  }
});

await test("the shared PATCH path keeps manual moves unchanged", async () => {
  const job = await create({ agentReview: review("drop") });
  const response = await call("PATCH", { query: { id: job.id }, body: { stage: "reviewing", decision: { reasons: ["Right stack"], note: "Good team." } } });
  assert.equal(response.status, 200); assert.equal(response.body.job.stage, "reviewing");
  const [decision] = await listReviewDecisions();
  assert.deepEqual([decision.decidedBy, decision.overridesAgent, decision.agentLean, decision.direction, decision.note], ["bernardo", false, "drop", "advance", "Good team."]);
  const guarded = await updateJobFromBody(job.id, { stage: "applied" }, { guard: () => false });
  assert.equal(guarded.status, 409);
  assert.equal((await getJob(job.id)).stage, "reviewing");
  assert.equal((await call("PATCH", { query: { id: job.id }, body: { stage: "nowhere" } })).status, 400);
  assert.equal((await call("PATCH", { query: { id: "missing" }, body: { stage: "applied" } })).status, 404);
});

console.log(`passed ${passed}, failed ${failed}`);
process.exit(failed ? 1 : 0);
