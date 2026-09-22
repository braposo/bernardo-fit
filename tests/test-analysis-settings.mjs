import assert from "node:assert/strict";
import { initialSettingsDocument } from "../lib/sanity/settings-document.js";
import { loadAnalysisSettings, settingsFromDocument, settingsFingerprint, settingsText,
  withSettingsSnapshot, withAnalysisSettings, ANALYSIS_SETTINGS_QUERY } from "../lib/sanity/analysis-settings.js";
import { buildSystemPrompt } from "../lib/profile.js";
import { buildCoverPrompt } from "../lib/cover.js";
import { buildAnswerPrompt } from "../lib/answer.js";
import { answerPolicy } from "../lib/answer-policy.js";
import { runAnalysis, analysisContext } from "../lib/analyze.js";
import { assessFit, scoringFingerprint } from "../lib/jev-scoring.js";
import { executeJevWork } from "../lib/jev-work.js";
import { analysisFingerprint, coverFingerprint, researchFingerprint } from "../lib/generation-fingerprint.js";
import { jobSummary } from "../lib/job-view.js";
import { saveJob, getJob } from "../lib/store.js";

let passed = 0, failed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log("ok", name); }
  catch (error) { failed++; console.error("FAIL", name, error); }
}
const original = initialSettingsDocument();
const snapshot = settingsFromDocument(original);
const revised = structuredClone(original);
revised.texts.find(t => t.key === "candidateProfile").text = "SANITY CANDIDATE EVIDENCE";
revised.texts.find(t => t.key === "analysis").text += "\nSANITY ANALYSIS DIRECTION";
revised.texts.find(t => t.key === "slopTop").text = "SANITY SHARED STYLE";
revised.questions.find(q => q.key === "responsibilities").instructions = "SANITY JEV DIRECTIONS";
revised.questions.find(q => q.key === "responsibilities").criteria[4] = "SANITY TOP RATING";
revised.facts[0].answer = "SANITY CONFIRMED ANSWER";
revised.dimensions[0].weight = 30;
revised.dimensions[1].weight = 20;
const changed = settingsFromDocument(revised);
const job = {company: "Example", role: "Engineer", jobDescription: "Build a product with a small engineering team."};

await test("seeding retains baseline semantics and fingerprint", () => {
  assert.equal(snapshot.fingerprint, settingsFingerprint());
  assert.notEqual(snapshot.fingerprint, changed.fingerprint);
});
await test("published edits reach every full-profile prompt", () => withSettingsSnapshot(changed, () => {
  const prompts = [buildSystemPrompt().stable, buildCoverPrompt({report: job}).stable,
    buildAnswerPrompt({question: "Why?", report: job}).stable];
  for (const prompt of prompts) {
    assert.match(prompt, /SANITY CANDIDATE EVIDENCE/);
    assert.match(prompt, /SANITY SHARED STYLE/);
  }
  assert.match(prompts[0], /SANITY ANALYSIS DIRECTION/);
  assert.equal(answerPolicy({question: revised.facts[0].question, economy: true}).fact, "SANITY CONFIRMED ANSWER");
}));
await test("API settings fetch uses the published singleton and fails closed", async () => {
  let called = 0;
  const client = {fetch: async query => { called++; assert.equal(query, ANALYSIS_SETTINGS_QUERY); return revised; }};
  assert.equal((await loadAnalysisSettings({}, client)).fingerprint, snapshot.fingerprint);
  assert.equal(called, 0);
  assert.equal((await loadAnalysisSettings({SANITY_ANALYSIS_ENABLED: "1"}, client)).fingerprint, changed.fingerprint);
  await assert.rejects(loadAnalysisSettings({SANITY_ANALYSIS_ENABLED: "1"}, {fetch: async () => null}), {code: "SANITY_SETTINGS_INVALID"});
  await assert.rejects(loadAnalysisSettings({SANITY_ANALYSIS_ENABLED: "1"}, {fetch: async () => {throw Error("secret upstream");}}),
    {code: "SANITY_SETTINGS_UNAVAILABLE"});
});
await test("malformed rubrics, keys, templates and weights cannot reach a model", () => {
  const mutations = [d => d.dimensions[0].weight++, d => d.questions[0].criteria.pop(),
    d => d.questions[0].type = "choice", d => d.texts.pop(), d => d.texts[0].key = "unknown",
    d => d.texts[0].text = "{{unknown}}", d => d.questions.find(q => q.key === "posting").options[0].key = "other"];
  for (const mutate of mutations) { const bad = structuredClone(original); mutate(bad);
    assert.throws(() => settingsFromDocument(bad), {code: "SANITY_SETTINGS_INVALID"}); }
});
await test("concurrent tasks retain isolated immutable snapshots", async () => {
  const results = await Promise.all([snapshot, changed].map(value => withSettingsSnapshot(value, async () => {
    await new Promise(resolve => setImmediate(resolve));
    return withAnalysisSettings(() => ({fingerprint: settingsFingerprint(), text: settingsText("candidateProfile")}));
  })));
  assert.equal(results[0].fingerprint, snapshot.fingerprint);
  assert.equal(results[1].text, "SANITY CANDIDATE EVIDENCE");
  assert.throws(() => {changed.questions.responsibilities.instructions = "mutated";}, TypeError);
});
await test("settings changes invalidate review, scoring, prose and research reuse", () => {
  const fingerprints = () => [scoringFingerprint(job), analysisFingerprint(job, "gpt-5.6-sol"),
    coverFingerprint(job, {}, "gpt-5.6-sol"), researchFingerprint(job), JSON.stringify(analysisContext())];
  const a = withSettingsSnapshot(snapshot, fingerprints), b = withSettingsSnapshot(changed, fingerprints);
  assert.ok(a.every((value, i) => value !== b[i]));
  assert.equal(withSettingsSnapshot(changed, () => jobSummary({...job, jevAssessment: {fingerprint: a[0], dimensions: []}}).jevStale), true);
});

process.env.TYPESAFE_API_KEY = "synthetic";
process.env.ANTHROPIC_API_KEY = "synthetic";
let calls = [];
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body); calls.push(body);
  if (url.includes("typesafe.ai")) return {ok: true, status: 200, json: async () => ({model: "jev-1.13.0",
    answers: Object.fromEntries(Object.entries(body.questions).map(([key, q]) => [key, q.type === "noul"
      ? {type: "noul", noul: 0.99} : q.type === "score"
      ? {type: "score", score: 3, confidence: 0.9, probabilities: {0:0,1:0,2:0,3:1,4:0}}
      : {type: "choice", choice: key === "constraint" ? "clear" : "complete", confidence: 0.9,
        probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === (key === "constraint" ? "clear" : "complete") ? 1 : 0]))}]))})};
  return {ok: true, status: 200, json: async () => ({content: [{type: "text", text: JSON.stringify({
    company: "Example", job_title: "Engineer", pitch: "Supported evidence", categories: [], differentiators: [], closing: "Done",
  })}], stop_reason: "end_turn"})};
};
await test("actual Jev request consumes edited instructions, evidence and rubric", async () => {
  const result = await withSettingsSnapshot(changed, () => assessFit(job));
  const body = calls.at(-1);
  assert.equal(body.state.candidate, "SANITY CANDIDATE EVIDENCE");
  assert.equal(body.questions.responsibilities.instructions, "SANITY JEV DIRECTIONS");
  assert.equal(body.questions.responsibilities.criteria[4], "SANITY TOP RATING");
  assert.equal(result.dimensions[0].weight, 30);
});
await test("actual analysis request and saved provenance use the same settings", async () => {
  const result = await withSettingsSnapshot(changed, () => runAnalysis(job.jobDescription, {model: "claude-sonnet-5"}));
  assert.match(JSON.stringify(calls.at(-1).system), /SANITY ANALYSIS DIRECTION/);
  assert.equal(result.report.generation.settings, changed.fingerprint);
});
await test("queued old-settings assessment is superseded before a paid call", async () => {
  const fingerprint = withSettingsSnapshot(snapshot, () => scoringFingerprint(job));
  const saved = await saveJob({...job, jevRun: {requestId: "settings-test", status: "queued", fingerprint}});
  const before = calls.length;
  const result = await withSettingsSnapshot(changed, () => executeJevWork({jobId: saved.id, requestId: "settings-test", fingerprint}));
  assert.equal(result.outcome, "superseded");
  assert.equal((await getJob(saved.id)).jevRun.status, "superseded");
  assert.equal(calls.length, before);
});
console.log(`passed ${passed}, failed ${failed}`);
process.exitCode = failed ? 1 : 0;
