process.env.ADMIN_SECRET = "preferences-test";
import assert from "node:assert/strict";
import { DEFAULT_REVIEW_AGENT } from "../lib/sanity/review-agent-settings.js";
import { initialSettingsDocument } from "../lib/sanity/settings-document.js";
import { settingsFromDocument, withSettingsSnapshot } from "../lib/sanity/analysis-settings.js";
import { validateRuleText, sameRule, ruleId, parseRuleProposals, preferenceLearningInput, learnPreferences, writePreferenceRules,
  addProposedRules, decidePreferenceRule, listPreferenceRules, acceptedPreferenceRules, preferenceNeedsYouItems,
  resetReviewPreferencesForTests, setReviewPreferencesClient, LEARN_PREFERENCES_MODEL, LEARN_PREFERENCES_PROMPT,
  NEEDS_YOU_PREFERENCE_KIND, REVIEW_PREFERENCES_ID, RULES_PER_RUN } from "../lib/review-preferences.js";
import { executeJobReview, needsYouItems, REVIEW_POLICY } from "../lib/review-agent.js";
import { listReviewDecisions, recordReviewDecision, resetReviewDecisionsForTests } from "../lib/review-decisions.js";
import { resetStatusProposalsForTests } from "../lib/status-proposals.js";
import { saveJob } from "../lib/store.js";
import handler from "../api/admin/jobs.js";

let passed = 0, failed = 0;
async function test(name, fn) {
  resetReviewDecisionsForTests();
  resetReviewPreferencesForTests();
  resetStatusProposalsForTests();
  setReviewPreferencesClient(null);
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.error("  FAIL " + name, e); }
}
const realFetch = globalThis.fetch;
globalThis.fetch = async url => { throw new Error(`No network in tests: ${url}`); };
function call(method, { query = {}, body } = {}) {
  return new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; }, json(data) { resolve({ status: this.statusCode, body: data }); return this; } };
    handler({ method, query, body, headers: { "x-admin-secret": "preferences-test" } }, res);
  });
}

const settings = { ...DEFAULT_REVIEW_AGENT, enabled: true, learnPreferences: true };
const enabled = settingsFromDocument({ ...initialSettingsDocument(), reviewAgent: settings });
const decision = (i, extra = {}) => ({ _id: `review-decision.job-${i}.${1000 + i}`, jobId: `job-${i}`, company: `Co ${i}`, role: "Engineering Manager",
  score: 70, direction: i % 2 ? "drop" : "advance", reasons: [i % 2 ? "Commute or office days" : "Right stack"], note: "",
  decidedAt: new Date(Date.parse("2026-10-20T00:00:00Z") + i * 60000).toISOString(), ...extra });
const decisions = count => Array.from({ length: count }, (_, i) => decision(count - i));
const refsFor = n => new Map(Array.from({ length: n }, (_, i) => [`d${i + 1}`, `id-${i + 1}`]));
const assessment = { model: "jev-1.13.0", policy: "synthetic", fingerprint: "fp-1", assessedAt: "2026-10-28T08:00:00.000Z", score: 72,
  dimensions: [{ id: "responsibilities", label: "Responsibilities", weight: 100, score: 72, confidence: 0.8, probabilities: {} }],
  posting: { type: "choice", choice: "complete", probabilities: { complete: 1 } }, constraint: { type: "choice", choice: "clear", probabilities: { conflict: 0, clear: 1, unknown: 0 } },
  blocked: false, provisional: false, status: "complete" };

await test("rule text is one plain line and similar rules count as the same", () => {
  assert.equal(validateRuleText("  London roles need two office days  a week or fewer. "), "London roles need two office days a week or fewer.");
  for (const bad of ["", "   ", 7, null, "x".repeat(201), "See https://example.com", "Use **bold**", "<b>no</b>"])
    assert.throws(() => validateRuleText(bad), e => e.status === 400);
  assert.ok(sameRule("London roles need two office days a week or fewer.", "london roles need two office days a week, or fewer"));
  assert.ok(!sameRule("London roles need two office days a week or fewer.", "Drop roles where most of the job is hands-on coding."));
  assert.equal(ruleId("London roles: two days or fewer."), ruleId("london roles two days or fewer"));
});

await test("proposals are parsed and validated rule by rule", () => {
  const refs = refsFor(6);
  const text = JSON.stringify({ rules: [
    { text: "London roles need two office days a week or fewer.", decisions: ["d1", "d3", "d3", "d99"] },
    { text: "Drop roles that are mostly hands-on coding.", decisions: ["d2"] },
    { text: "See https://x.example for more.", decisions: ["d1", "d2"] },
    { text: "London roles need two office days a week, or fewer.", decisions: ["d4", "d5"] },
    { text: "Salary under £110k is a drop.", decisions: ["d2", "d4"] },
    { text: 42, decisions: ["d1", "d2"] },
    { text: "Fintech is fine when the team is at least six engineers.", decisions: "d1" },
  ] });
  assert.deepEqual(parseRuleProposals(text, refs), [
    { text: "London roles need two office days a week or fewer.", sourceDecisionIds: ["id-1", "id-3"] },
    { text: "Salary under £110k is a drop.", sourceDecisionIds: ["id-2", "id-4"] }]);
  assert.deepEqual(parseRuleProposals("```json\n" + JSON.stringify({ rules: [{ text: "Prefer remote UK roles.", decisions: ["d1", "d2"] }] }) + "\n```", refs),
    [{ text: "Prefer remote UK roles.", sourceDecisionIds: ["id-1", "id-2"] }]);
  for (const bad of ["not json", "[]", '{"rules": "x"}', "null"]) assert.deepEqual(parseRuleProposals(bad, refs), []);
  const many = JSON.stringify({ rules: Array.from({ length: 8 }, (_, i) => ({ text: `Rule number ${["one", "two", "three", "four", "five", "six", "seven", "eight"][i]} about offices.`, decisions: ["d1", "d2"] })) });
  assert.equal(parseRuleProposals(many, refs).length, RULES_PER_RUN);
});

await test("the learning input names decisions by ref and adds the job's facts", () => {
  const { input, refs } = preferenceLearningInput([decision(1, { note: "x".repeat(400) }), decision(2)], {
    jobs: [{ id: "job-1", location: "London", locationMode: "hybrid", salary: "£120k" }],
    rules: [{ id: "r1", text: "Old wording.", editedText: "His wording.", state: "accepted", createdAt: "2026-10-01T00:00:00Z" },
      { id: "r2", text: "No.", state: "rejected" }] });
  assert.deepEqual([...refs], [["d1", "review-decision.job-1.1001"], ["d2", "review-decision.job-2.1002"]]);
  assert.deepEqual(input.decisions[0], { ref: "d1", decision: "dropped", company: "Co 1", role: "Engineering Manager", score: 70,
    location: "London", locationMode: "hybrid", salary: "£120k", reasons: ["Commute or office days"], note: "x".repeat(300) });
  assert.equal(input.decisions[1].decision, "moved forward"); assert.equal(input.decisions[1].location, "");
  assert.deepEqual(input.existingRules, [{ text: "His wording.", state: "accepted" }, { text: "No.", state: "rejected" }]);
});

await test("the weekly run proposes rules from Bernardo's decisions only, and never repeats one", async () => {
  const jobs = async () => [];
  const never = async () => { throw new Error("must not call the model"); };
  assert.deepEqual(await learnPreferences({ settings: { ...settings, learnPreferences: false }, loadDecisions: async () => decisions(20), loadJobs: jobs, write: never }), { outcome: "disabled" });
  assert.deepEqual(await learnPreferences({ settings: null, loadDecisions: async () => decisions(20), loadJobs: jobs, write: never }), { outcome: "disabled" });
  // Agent moves, other moves and calls without a reason or note do not count.
  const thin = [...decisions(9), decision(50, { decidedBy: "agent" }), decision(51, { direction: "other" }), decision(52, { reasons: [], note: " " })];
  assert.equal((await learnPreferences({ settings, loadDecisions: async () => thin, loadJobs: jobs, write: never })).outcome, "too-few-decisions");
  let request;
  const history = [decision(99, { decidedBy: "agent", decidedAt: "2026-10-28T00:00:00.000Z" }), ...decisions(12)];
  const write = async args => { request = args; return [
    { text: "London roles need two office days a week or fewer.", sourceDecisionIds: [history[1]._id, history[3]._id] },
    { text: "Drop roles that are mostly hands-on coding.", sourceDecisionIds: [history[2]._id, history[4]._id] }]; };
  const first = await learnPreferences({ settings, loadDecisions: async () => history, loadJobs: jobs, write, now: new Date("2026-11-02T07:00:00Z") });
  assert.deepEqual(first, { outcome: "learned", decisions: 12, proposed: 2 });
  assert.equal(request.input.decisions.length, 12);
  assert.ok(!request.input.decisions.some(d => d.company === "Co 99"));
  assert.equal(request.ref, `learn-preferences:${history[1].decidedAt}`);
  let { rules, lastLearnedAt } = await listPreferenceRules();
  assert.equal(lastLearnedAt, "2026-11-02T07:00:00.000Z");
  assert.deepEqual(rules.map(r => [r.state, r.text]).sort(), [["proposed", "Drop roles that are mostly hands-on coding."], ["proposed", "London roles need two office days a week or fewer."]]);
  assert.deepEqual(Object.keys(rules[0]).sort(), ["createdAt", "decidedAt", "id", "sourceDecisionIds", "state", "text"]);
  // Nothing decided since: no model call.
  assert.deepEqual(await learnPreferences({ settings, loadDecisions: async () => history, loadJobs: jobs, write: never }), { outcome: "no-new-decisions" });
  // A rejected rule and a reworded duplicate are not proposed again.
  const london = rules.find(r => r.text.startsWith("London"));
  await decidePreferenceRule(london.id, "reject");
  const newer = [decision(200, { decidedAt: "2026-11-05T00:00:00.000Z" }), ...history];
  const second = await learnPreferences({ settings, loadDecisions: async () => newer, loadJobs: jobs, write: async args => {
    assert.ok(args.input.existingRules.some(r => r.state === "rejected" && r.text.startsWith("London")));
    return [{ text: "London roles need two office days a week, or fewer.", sourceDecisionIds: ["a", "b"] },
      { text: "Drop roles that are mostly hands on coding.", sourceDecisionIds: ["a", "b"] },
      { text: "Salary under £110k is a drop.", sourceDecisionIds: ["a", "b"] }]; } });
  assert.deepEqual(second, { outcome: "learned", decisions: 13, proposed: 1 });
  ({ rules } = await listPreferenceRules());
  assert.equal(rules.length, 3);
  assert.deepEqual((await addProposedRules([{ text: "Salary under £110k is a drop!", sourceDecisionIds: ["c", "d"] }])), []);
});

await test("accept, reject, edit and delete; only accepted rules reach the agent", async () => {
  const added = await addProposedRules([
    { text: "London roles need two office days a week or fewer.", sourceDecisionIds: ["a", "b"] },
    { text: "Drop roles that are mostly hands-on coding.", sourceDecisionIds: ["a", "c"] },
    { text: "Salary under £110k is a drop.", sourceDecisionIds: ["b", "c"] }], { now: new Date("2026-11-02T07:00:00Z") });
  const [london, coding, salary] = added;
  assert.deepEqual(await acceptedPreferenceRules(), []);
  const accepted = await decidePreferenceRule(london.id, "accept", { now: new Date("2026-11-03T09:00:00Z") });
  assert.deepEqual(accepted.rule, { ...london, state: "accepted", decidedAt: "2026-11-03T09:00:00.000Z" });
  await assert.rejects(decidePreferenceRule(london.id, "accept"), e => e.status === 409);
  const edited = await decidePreferenceRule(coding.id, "edit", { text: "Drop roles where over half the job is hands-on coding." });
  assert.equal(edited.rule.state, "accepted"); assert.equal(edited.rule.editedText, "Drop roles where over half the job is hands-on coding.");
  assert.equal(edited.rule.text, coding.text);
  await assert.rejects(decidePreferenceRule(coding.id, "edit", { text: "" }), e => e.status === 400);
  await decidePreferenceRule(salary.id, "reject");
  assert.deepEqual(await acceptedPreferenceRules(), ["London roles need two office days a week or fewer.", "Drop roles where over half the job is hands-on coding."]);
  // Rejecting an accepted rule takes it out of the prompt and keeps the edit.
  const rejected = await decidePreferenceRule(coding.id, "reject");
  assert.equal(rejected.rule.editedText, "Drop roles where over half the job is hands-on coding.");
  assert.deepEqual(await acceptedPreferenceRules(), ["London roles need two office days a week or fewer."]);
  assert.deepEqual(await decidePreferenceRule(salary.id, "delete"), { deleted: salary.id });
  assert.equal((await listPreferenceRules()).rules.length, 2);
  await assert.rejects(decidePreferenceRule(salary.id, "accept"), e => e.status === 404);
  await assert.rejects(decidePreferenceRule(london.id, "approve"), e => e.status === 400);
  assert.deepEqual((await listPreferenceRules({ state: "accepted" })).rules.map(r => r.id), [london.id]);
  await assert.rejects(listPreferenceRules({ state: "open" }), e => e.status === 400);
});

await test("accepted rules are added to the review inputs", async () => {
  const [london, coding] = await addProposedRules([
    { text: "London roles need two office days a week or fewer.", sourceDecisionIds: ["a", "b"] },
    { text: "Drop roles that are mostly hands-on coding.", sourceDecisionIds: ["a", "c"] }]);
  await decidePreferenceRule(london.id, "edit", { text: "London roles need two office days or fewer." });
  assert.equal(coding.state, "proposed");
  const job = await saveJob({ company: "Office Co", role: "Engineering Manager", location: "London", jevAssessment: assessment });
  let request, noteArgs;
  const result = await withSettingsSnapshot(enabled, () => executeJobReview({ jobId: job.id }, {
    evaluate: async args => { request = args; return { answers: { advance: { type: "boolean", probability: 0.5 }, drop: { type: "boolean", probability: 0.3 } }, model: "jev" }; },
    write: async args => { noteArgs = args; return { reason: "", question: "" }; } }));
  assert.equal(result.outcome, "reviewed");
  assert.deepEqual(request.state.learnedPreferences, ["London roles need two office days or fewer."]);
  assert.deepEqual(noteArgs.rules, ["London roles need two office days or fewer."]);
  assert.match(request.questions.advance.instructions, /state\.learnedPreferences/);
  assert.equal(REVIEW_POLICY, "2026-10-29-review-3");
});

await test("proposed rules are Needs you items after the existing kinds, whose shapes are unchanged", async () => {
  const [rule] = await addProposedRules([{ text: "London roles need two office days a week or fewer.", sourceDecisionIds: ["review-decision.j1.1", "gone"] }],
    { now: new Date("2026-11-02T07:00:00Z") });
  const accepted = (await addProposedRules([{ text: "Salary under £110k is a drop.", sourceDecisionIds: ["x", "y"] }], { now: new Date("2026-11-01T07:00:00Z") }))[0];
  await decidePreferenceRule(accepted.id, "accept");
  const { rules } = await listPreferenceRules();
  const review = { lean: "ask", advanceProbability: 0.5, dropProbability: 0.3, reason: "R.", question: "Q?", reviewedAt: "2026-10-28T09:00:00.000Z" };
  const items = needsYouItems([{ id: "k1", stage: "new", company: "A", role: "EM", jevAssessment: { score: 60 }, agentReview: review }],
    { preferences: rules, decisions: [{ _id: "review-decision.j1.1", jobId: "j1", company: "Acme", role: "EM", direction: "drop" }] });
  assert.deepEqual(items, [
    { id: "k1", company: "A", role: "EM", score: 60, location: "", lean: "ask", advanceProbability: 0.5, dropProbability: 0.3, reason: "R.", question: "Q?", reviewedAt: "2026-10-28T09:00:00.000Z" },
    { kind: NEEDS_YOU_PREFERENCE_KIND, id: rule.id, text: "London roles need two office days a week or fewer.", sourceDecisionIds: ["review-decision.j1.1", "gone"],
      sources: [{ id: "review-decision.j1.1", jobId: "j1", company: "Acme", role: "EM", direction: "drop" }], createdAt: "2026-11-02T07:00:00.000Z" }]);
  assert.deepEqual(preferenceNeedsYouItems(rules).map(i => i.sources), [[]]);
  // Over HTTP: listing, Needs you, the jobs count and the actions.
  await recordReviewDecision({ job: { id: "j2", company: "Beta", role: "EM" }, toStage: "not_interested", decision: { reasons: ["Too hands-on"] } });
  const needsYou = await call("GET", { query: { needsYou: "1" } });
  assert.equal(needsYou.status, 200);
  assert.deepEqual(needsYou.body.items.filter(i => i.kind === NEEDS_YOU_PREFERENCE_KIND).map(i => i.id), [rule.id]);
  const list = await call("GET");
  assert.equal(list.body.needsYouCount, needsYou.body.items.length);
  const listed = await call("GET", { query: { preferences: "1" } });
  assert.equal(listed.status, 200); assert.equal(listed.body.rules.length, 2); assert.equal(listed.body.lastLearnedAt, "2026-11-01T07:00:00.000Z");
  assert.deepEqual((await call("GET", { query: { preferences: "1", state: "accepted" } })).body.rules.map(r => r.id), [accepted.id]);
  assert.equal((await call("GET", { query: { preferences: "1", state: "bogus" } })).status, 400);
  const edit = await call("POST", { body: { action: "edit-preference", id: rule.id, text: "London roles need two days or fewer." } });
  assert.equal(edit.status, 200); assert.equal(edit.body.rule.state, "accepted"); assert.equal(edit.body.rule.editedText, "London roles need two days or fewer.");
  assert.equal((await call("POST", { body: { action: "reject-preference", id: rule.id } })).body.rule.state, "rejected");
  assert.equal((await call("POST", { body: { action: "accept-preference", id: rule.id } })).body.rule.state, "accepted");
  assert.deepEqual((await call("POST", { body: { action: "delete-preference", id: accepted.id } })).body, { deleted: accepted.id });
  assert.equal((await call("POST", { body: { action: "accept-preference" } })).status, 400);
  assert.equal((await call("POST", { body: { action: "accept-preference", id: "rule-missing" } })).status, 404);
  assert.equal((await call("POST", { body: { action: "edit-preference", id: rule.id, text: "x".repeat(300) } })).status, 400);
  assert.equal((await call("GET", { query: { needsYou: "1" } })).body.items.filter(i => i.kind === NEEDS_YOU_PREFERENCE_KIND).length, 0);
});

await test("the model request sends the decisions and parses the answer", async () => {
  process.env.OPENAI_API_KEY = "synthetic-openai";
  let body;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text",
      text: JSON.stringify({ rules: [{ text: "London roles need two office days a week or fewer.", decisions: ["d1", "d2"] }] }) }] }] }), { status: 200 });
  };
  try {
    const { input, refs } = preferenceLearningInput([decision(1), decision(2)]);
    const proposals = await writePreferenceRules({ input, refs, ref: "learn-preferences:test" });
    assert.deepEqual(proposals, [{ text: "London roles need two office days a week or fewer.", sourceDecisionIds: [decision(1)._id, decision(2)._id] }]);
    assert.equal(body.model, LEARN_PREFERENCES_MODEL); assert.equal(body.reasoning.effort, "low");
    assert.ok(body.instructions.startsWith(LEARN_PREFERENCES_PROMPT));
    assert.deepEqual(JSON.parse(body.input[0].content), input);
  } finally { globalThis.fetch = async url => { throw new Error(`No network in tests: ${url}`); }; }
});

await test("Sanity writes create the document once and are revision-guarded", async () => {
  let doc = null, conflictOnce = true;
  const writes = [];
  const commit = fields => { doc = { ...doc, ...fields, _rev: `r${writes.length}` }; return { ...doc }; };
  setReviewPreferencesClient({
    fetch: async (query, params) => { assert.equal(params.type, "reviewPreferences"); assert.equal(params.id, REVIEW_PREFERENCES_ID); return doc ? { ...doc } : null; },
    create: async value => { writes.push(["create", value]); return commit(value); },
    patch: id => { assert.equal(id, REVIEW_PREFERENCES_ID); let rev; return {
      ifRevisionId(r) { rev = r; return this; },
      set(fields) { return { commit: async () => {
        writes.push(["patch", rev]);
        if (conflictOnce) { conflictOnce = false; throw Object.assign(new Error("conflict"), { statusCode: 409 }); }
        return commit(fields); } }; } }; },
  });
  const [rule] = await addProposedRules([{ text: "Prefer remote UK roles.", sourceDecisionIds: ["a", "b"] }]);
  assert.equal(writes[0][0], "create"); assert.equal(writes[0][1]._type, "reviewPreferences");
  assert.equal(doc.rules[0]._key, rule.id);
  await decidePreferenceRule(rule.id, "accept");
  assert.deepEqual(writes.slice(1).map(w => w[0]), ["patch", "patch"], "a conflict is re-read and reapplied");
  assert.deepEqual(await acceptedPreferenceRules(), ["Prefer remote UK roles."]);
});

globalThis.fetch = realFetch;
console.log(`passed ${passed}, failed ${failed}`);
process.exit(failed ? 1 : 0);
