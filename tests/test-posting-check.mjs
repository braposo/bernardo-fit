process.env.ADMIN_SECRET = "posting-check-test";
import assert from "node:assert/strict";
import { DEFAULT_POSTING_CHECK, validatePostingCheck } from "../lib/sanity/posting-check-settings.js";
import { initialSettingsDocument } from "../lib/sanity/settings-document.js";
import { settingsFromDocument, withSettingsSnapshot, postingCheckSettings, ANALYSIS_SETTINGS_QUERY } from "../lib/sanity/analysis-settings.js";
import { detectAts, findAtsTarget, atsApiUrl, parseAtsResponse, fetchAtsPosting, atsRetryPolicy, parsePastedQuestions, questionId } from "../lib/ats-forms.js";
import { executePostingCheck, requestPostingCheck, postingIdempotencyKey, postingFingerprint, missingKinds, parseGapNote, gapsFromKinds,
  personalQuestion, postingActionPatch, postingNeedsYouItems, postingCheckProgress, carryUserStates, GAP_QUESTIONS, GAP_TEMPLATES,
  POSTING_CHECK_POLICY, GAP_NOTE_MODEL } from "../lib/posting-check.js";
import { needsYouItems } from "../lib/review-agent.js";
import { jobSummary, jobDetail } from "../lib/job-view.js";
import { runtimeFields } from "../lib/sanity/codecs.js";
import { saveJob, getJob, mutateJob, saveReport } from "../lib/store.js";
import handler from "../api/admin/jobs.js";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.error("  FAIL " + name, e); }
}
function call(method, { query = {}, body } = {}) {
  return new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; }, json(data) { resolve({ status: this.statusCode, body: data }); return this; } };
    handler({ method, query, body, headers: { "x-admin-secret": "posting-check-test" } }, res);
  });
}

const settings = { ...DEFAULT_POSTING_CHECK, enabled: true };
const enabled = settingsFromDocument({ ...initialSettingsDocument(), postingCheck: settings });
const disabled = settingsFromDocument(initialSettingsDocument());
const unpublished = settingsFromDocument({ ...initialSettingsDocument(), postingCheck: undefined });
const GH_URL = "https://job-boards.greenhouse.io/syntheticco/jobs/4012345";
const create = extra => saveJob({ company: "Synthetic Co", role: "Engineering Manager", stage: "reviewing", location: "London",
  sourceUrl: GH_URL, jobDescription: "Lead a team of 6 engineers building dependable software. Salary £110,000.", ...extra });
const greenhouseBody = {
  title: "Engineering Manager", location: { name: "London, UK" },
  pay_input_ranges: [{ min_cents: 10000000, max_cents: 12000000, currency_type: "GBP", title: "UK" }],
  questions: [
    { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text" }] },
    { label: "Resume/CV", required: true, fields: [{ name: "resume", type: "input_file" }, { name: "resume_text", type: "textarea" }] },
    { label: "LinkedIn Profile", required: false, fields: [{ name: "question_1", type: "input_text" }] },
    { label: "Why do you want to work at Synthetic Co?", required: true, fields: [{ name: "question_2", type: "textarea" }] },
    { label: "Do you have the right to work in the UK?", required: true, fields: [{ name: "question_3", type: "multi_value_single_select",
      values: [{ label: "Yes", value: 1 }, { label: "No", value: 0 }] }] },
    { label: "What is your salary expectation?", required: true, fields: [{ name: "question_4", type: "input_text" }] },
    { label: "Describe a system you scaled.", description: "<p>Max 200 words</p>", required: false, fields: [{ name: "question_5", type: "textarea" }] },
    { label: "Upload a portfolio", required: false, fields: [{ name: "question_6", type: "input_file" }] },
  ],
};
const jevAnswers = probabilities => ({ answers: Object.fromEntries(Object.entries(probabilities).map(([k, p]) => [k, { type: "boolean", probability: p }])), model: "jev-1.13.0" });
const stubFetch = async target => ({ status: 200, form: parseAtsResponse(target, greenhouseBody) });
const stubAnswer = calls => async args => {
  calls.push(args);
  if (/Describe/.test(args.question)) return { refused: true, reason: "It needs a specific scaling example.", answer: "" };
  return { refused: false, reason: "", answer: `Draft for: ${args.question}` };
};

await test("posting check settings validate and stay out of the scoring fingerprint", () => {
  assert.deepEqual(DEFAULT_POSTING_CHECK, { enabled: false, gapThreshold: 0.5, fetchApplicationForms: true, draftAnswers: true, maxDraftAnswers: 8, requestTimeoutSeconds: 20 });
  assert.deepEqual(validatePostingCheck({ ...DEFAULT_POSTING_CHECK, extra: 1 }), DEFAULT_POSTING_CHECK);
  for (const patch of [{ enabled: "yes" }, { draftAnswers: 1 }, { fetchApplicationForms: null }, { gapThreshold: 0.05 }, { gapThreshold: 0.95 },
    { gapThreshold: "0.5" }, { maxDraftAnswers: 21 }, { maxDraftAnswers: -1 }, { maxDraftAnswers: 1.5 }, { requestTimeoutSeconds: 4 }, { requestTimeoutSeconds: 61 }])
    assert.throws(() => validatePostingCheck({ ...DEFAULT_POSTING_CHECK, ...patch }), /posting check settings/);
  for (const bad of [null, [], "x"]) assert.throws(() => validatePostingCheck(bad), /posting check settings/);
  assert.match(ANALYSIS_SETTINGS_QUERY, /postingCheck/);
  assert.deepEqual(initialSettingsDocument().postingCheck, DEFAULT_POSTING_CHECK);
  assert.equal(enabled.fingerprint, disabled.fingerprint);
  assert.equal(enabled.fingerprint, unpublished.fingerprint);
  assert.throws(() => settingsFromDocument({ ...initialSettingsDocument(), postingCheck: { ...DEFAULT_POSTING_CHECK, gapThreshold: 2 } }), /posting check settings/);
  withSettingsSnapshot(enabled, () => assert.deepEqual(postingCheckSettings(), settings));
  withSettingsSnapshot(unpublished, () => assert.equal(postingCheckSettings(), null));
  assert.equal(postingCheckSettings().enabled, false);
  assert.ok(runtimeFields.includes("postingCheck"));
});

await test("Greenhouse, Lever and Ashby posting and apply URLs are recognised", () => {
  assert.deepEqual(detectAts(GH_URL), { provider: "greenhouse", board: "syntheticco", id: "4012345", region: "", url: GH_URL });
  assert.equal(detectAts("https://boards.greenhouse.io/syntheticco/jobs/4012345?gh_src=x").id, "4012345");
  assert.equal(detectAts("https://job-boards.eu.greenhouse.io/syntheticco/jobs/77").region, "eu");
  assert.deepEqual(detectAts("https://boards.greenhouse.io/embed/job_app?for=syntheticco&token=4012345")?.board, "syntheticco");
  const lever = detectAts("https://jobs.lever.co/synthetic/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b/apply");
  assert.deepEqual([lever.provider, lever.board, lever.id, lever.region], ["lever", "synthetic", "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b", ""]);
  assert.equal(detectAts("https://jobs.eu.lever.co/synthetic/0F1E2D3C-4B5A-6978-8A9B-0C1D2E3F4A5B").region, "eu");
  const ashby = detectAts("https://jobs.ashbyhq.com/Synthetic%20Co/6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d/application");
  assert.deepEqual([ashby.provider, ashby.board, ashby.id], ["ashby", "Synthetic%20Co", "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d"]);
  for (const bad of ["http://boards.greenhouse.io/x/jobs/1", "https://boards.greenhouse.io/x", "https://boards.greenhouse.io/x/jobs/abc",
    "https://evil.example/boards.greenhouse.io/x/jobs/1", "https://greenhouse.io.evil.example/x/jobs/1", "https://jobs.lever.co/x/not-a-uuid",
    "https://jobs.ashbyhq.com/x", "https://user:pw@jobs.lever.co/x/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b", "", null, "not a url",
    "https://www.linkedin.com/jobs/view/123456789"])
    assert.equal(detectAts(bad), null, String(bad));
  assert.equal(atsApiUrl(detectAts(GH_URL)), "https://boards-api.greenhouse.io/v1/boards/syntheticco/jobs/4012345?questions=true&pay_transparency=true");
  assert.equal(atsApiUrl(detectAts("https://job-boards.eu.greenhouse.io/syntheticco/jobs/77")), "https://boards-api.eu.greenhouse.io/v1/boards/syntheticco/jobs/77?questions=true&pay_transparency=true");
  assert.equal(atsApiUrl(lever), "https://api.lever.co/v0/postings/synthetic/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b");
  assert.equal(atsApiUrl(ashby), "https://api.ashbyhq.com/posting-api/job-board/Synthetic%20Co?includeCompensation=true");
  assert.equal(atsApiUrl({ provider: "greenhouse", board: "../admin", id: "1" }), "");
  assert.equal(atsApiUrl({ provider: "workday", board: "x", id: "1" }), "");
  // The job's URL first, then a link in its description or notes.
  assert.equal(findAtsTarget({ sourceUrl: "https://www.linkedin.com/jobs/view/123456789",
    jobDescription: `Apply here: ${GH_URL}.` })?.id, "4012345");
  assert.equal(findAtsTarget({ sourceUrl: "", notes: "See https://jobs.lever.co/synthetic/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b)" })?.provider, "lever");
  assert.equal(findAtsTarget({ sourceUrl: "https://example.com/careers/1", jobDescription: "No link." }), null);
});

await test("ATS responses become posting facts and custom questions only", () => {
  const gh = parseAtsResponse(detectAts(GH_URL), greenhouseBody);
  assert.deepEqual(gh.facts, { title: "Engineering Manager", location: "London, UK", salary: "100,000 to 120,000 GBP UK" });
  assert.deepEqual(gh.questions.map(q => q.text), ["Why do you want to work at Synthetic Co?", "Do you have the right to work in the UK?",
    "What is your salary expectation?", "Describe a system you scaled. (Max 200 words)"]);
  assert.deepEqual(gh.questions[1].options, ["Yes", "No"]);
  assert.equal(gh.questions[0].required, true); assert.equal(gh.questions[0].limit, 150); assert.equal(gh.questions[2].limit, 60);
  assert.equal(gh.questions[0].id, questionId("Why do you want to work at Synthetic Co?"));
  const lever = detectAts("https://jobs.lever.co/synthetic/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b");
  assert.deepEqual(parseAtsResponse(lever, { text: "EM", categories: { location: "Leeds", commitment: "Permanent" }, workplaceType: "hybrid",
    salaryRange: { min: 90000, max: 110000, currency: "GBP", interval: "per-year-salary" } }),
  { facts: { title: "EM", location: "Leeds", commitment: "Permanent", workplace: "hybrid", salary: "90,000 to 110,000 GBP per-year-salary" }, questions: [] });
  const ashby = detectAts("https://jobs.ashbyhq.com/synthetic/6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d");
  const ashbyBody = { jobs: [{ id: "other" }, { id: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d", title: "EM", location: "Remote UK", employmentType: "FullTime",
    isRemote: true, compensation: { compensationTierSummary: "£100K – £120K" } }] };
  assert.deepEqual(parseAtsResponse(ashby, ashbyBody).facts, { title: "EM", location: "Remote UK", commitment: "FullTime", workplace: "Remote", salary: "£100K – £120K" });
  assert.equal(parseAtsResponse(ashby, { jobs: [{ id: "other" }] }), null);
  assert.equal(parseAtsResponse(ashby, null), null);
});

await test("the form request makes one attempt and classifies provider errors", async () => {
  const target = detectAts(GH_URL), policy = DEFAULT_POSTING_CHECK;
  const seen = [];
  const ok = await fetchAtsPosting({ target, policy }, { fetchRequest: async (url, options) => { seen.push([url, options]);
    return new Response(JSON.stringify(greenhouseBody), { status: 200 }); } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], atsApiUrl(target)); assert.equal(seen[0][1].method, "GET"); assert.equal(seen[0][1].redirect, "error");
  assert.equal(seen[0][1].timeoutInMs, 20000); assert.deepEqual(seen[0][1].retry.byStatus, {});
  assert.equal(ok.form.questions.length, 4);
  const limited = await fetchAtsPosting({ target, policy }, { fetchRequest: async () => new Response("", { status: 429, headers: { "retry-after": "120" } }) }).catch(e => e);
  assert.match(limited.message, /HTTP 429/); assert.ok(limited.retryAt instanceof Date); assert.equal(limited.abort, undefined);
  assert.deepEqual(atsRetryPolicy({ error: limited }), { retryAt: limited.retryAt });
  assert.deepEqual(await fetchAtsPosting({ target, policy }, { fetchRequest: async () => new Response("", { status: 404 }) }), { status: 404, form: null });
  const forbidden = await fetchAtsPosting({ target, policy }, { fetchRequest: async () => new Response("", { status: 403 }) }).catch(e => e);
  assert.equal(forbidden.abort, true); assert.deepEqual(atsRetryPolicy({ error: forbidden }), { skipRetrying: true });
  const html = await fetchAtsPosting({ target, policy }, { fetchRequest: async () => new Response("<html>", { status: 200 }) }).catch(e => e);
  assert.equal(html.abort, true);
  const unsupported = await fetchAtsPosting({ target: { provider: "workday", board: "x", id: "1" }, policy }, { fetchRequest: async () => { throw new Error("must not fetch"); } }).catch(e => e);
  assert.equal(unsupported.abort, true);
  assert.equal(atsRetryPolicy({ error: new Error("network") }), undefined);
});

await test("pasted questions: one per line, markers stripped, contact fields dropped", () => {
  const pasted = parsePastedQuestions("1. Why this role?\n- What is your notice period? *\n\n• Email\nQ3: Tell us about a hard call (required)\nWhy this role?\nok");
  assert.deepEqual(pasted.map(q => [q.text, q.required]), [["Why this role?", false], ["What is your notice period?", true], ["Tell us about a hard call", true]]);
  assert.deepEqual(parsePastedQuestions(""), []);
  assert.equal(parsePastedQuestions(Array.from({ length: 40 }, (_, i) => `Question number ${i}?`).join("\n")).length, 30);
});

await test("gap rules: threshold, validation and templated fallback", () => {
  assert.deepEqual(Object.keys(GAP_QUESTIONS), ["salary", "location", "seniority", "contract"]);
  const answers = jevAnswers({ salary: 0.9, location: 0.2, seniority: 0.5, contract: 0.49 }).answers;
  assert.deepEqual(missingKinds(answers, 0.5), ["location", "contract"]);
  assert.deepEqual(missingKinds(answers, 0.1), []);
  assert.throws(() => missingKinds({ salary: answers.salary }, 0.5), /incomplete/);
  assert.throws(() => missingKinds({ ...answers, location: { probability: 1.5 } }, 0.5), /incomplete/);
  const notes = parseGapNote('```json\n{"location":{"why":" London, but  no office days given. ","question":"How many office days a week does it expect?"},'
    + '"contract":{"why":"See https://x.example","question":"No question mark"},"salary":{"why":"Not asked for","question":"Ignored?"}}\n```', ["location", "contract"]);
  assert.deepEqual(notes, { location: { why: "London, but no office days given.", question: "How many office days a week does it expect?" }, contract: { why: "", question: "" } });
  assert.deepEqual(parseGapNote("not json", ["salary"]), {});
  const gaps = gapsFromKinds(["location", "contract"], notes);
  assert.deepEqual(gaps[0], { id: "location", kind: "location", label: "Location and office days", why: "London, but no office days given.",
    question: "How many office days a week does it expect?", state: "open" });
  assert.deepEqual(gaps[1], { id: "contract", kind: "contract", ...GAP_TEMPLATES.contract, state: "open" });
  assert.ok(Object.values(GAP_TEMPLATES).every(t => t.question.endsWith("?") && t.why.length <= 200));
  assert.match(personalQuestion("What is your salary expectation?"), /Salary/);
  assert.match(personalQuestion("What is your notice period?"), /Notice/);
  assert.match(personalQuestion("Do you require visa sponsorship?"), /Right to work/);
  assert.equal(personalQuestion("Why do you want to work here?"), "");
});

await test("the check no-ops when off, unpublished, gone or not at Reviewing", async () => {
  const evaluate = async () => { throw new Error("must not call Jev"); };
  const job = await create();
  assert.equal((await withSettingsSnapshot(disabled, () => executePostingCheck({ jobId: job.id }, { evaluate }))).outcome, "disabled");
  assert.equal((await withSettingsSnapshot(unpublished, () => executePostingCheck({ jobId: job.id }, { evaluate }))).outcome, "disabled");
  await withSettingsSnapshot(enabled, async () => {
    assert.equal((await executePostingCheck({ jobId: "missing-job" }, { evaluate })).outcome, "missing");
    for (const extra of [{ stage: "new" }, { stage: "applied" }, { archived: true }])
      assert.equal((await executePostingCheck({ jobId: (await create(extra)).id }, { evaluate })).outcome, "not-reviewing");
  });
  assert.equal((await getJob(job.id)).postingCheck, null);
  assert.equal(jobSummary(await getJob(job.id)).postingCheck, null);
});

await test("a check saves gaps and form questions, then drafts answers once the fit page exists", async () => {
  const job = await create();
  let jevRequest, noteRequest;
  const calls = [];
  const deps = {
    now: new Date("2026-10-29T09:00:00Z"), fetchForm: stubFetch, answer: stubAnswer(calls),
    evaluate: async args => { jevRequest = args; return jevAnswers({ salary: 0.95, location: 0.2, seniority: 0.9, contract: 0.1 }); },
    write: async args => { noteRequest = args; return { notes: { location: { why: "It names London but no office days.", question: "How many office days a week in London?" } }, model: GAP_NOTE_MODEL }; },
  };
  // No fit page yet: gaps and questions are saved, drafting waits.
  let result = await withSettingsSnapshot(enabled, () => executePostingCheck({ jobId: job.id }, deps));
  assert.equal(result.outcome, "checked"); assert.equal(result.gaps, 2); assert.equal(result.drafted, 0);
  assert.equal(jevRequest.kind, "jev-posting-gaps"); assert.equal(jevRequest.questions, GAP_QUESTIONS);
  assert.equal(jevRequest.state.opportunity.company, "Synthetic Co");
  assert.equal(jevRequest.state.applicationSystem.salary, "100,000 to 120,000 GBP UK");
  assert.match(jevRequest.ref, new RegExp(`${POSTING_CHECK_POLICY}$`));
  assert.deepEqual(noteRequest.kinds, ["location", "contract"]);
  let saved = await getJob(job.id);
  assert.equal(saved.stage, "reviewing");
  assert.equal(saved.postingCheck.draftStatus, "waiting-for-fit");
  assert.equal(saved.postingCheck.form.source, "greenhouse");
  assert.ok(saved.postingCheck.form.questions.every(q => q.state === "pending" && !q.answerDraft));
  assert.equal(calls.length, 0);
  // Waiting questions are not Needs you items yet; the gaps are.
  assert.deepEqual(postingNeedsYouItems([saved]).map(i => i.kind), ["posting-gaps"]);
  const view = jobDetail(saved).postingCheck;
  assert.deepEqual(Object.keys(view), ["status", "policy", "checkedAt", "draftStatus", "gaps", "form"]);
  assert.equal(view.status, "checked"); assert.equal(view.checkedAt, "2026-10-29T09:00:00.000Z");
  assert.deepEqual(view.gaps[0], { id: "location", kind: "location", label: "Location and office days", why: "It names London but no office days.",
    question: "How many office days a week in London?", state: "open" });
  assert.equal(view.gaps[1].question, GAP_TEMPLATES.contract.question);
  assert.equal(view.form.facts, undefined); assert.equal(view.fingerprint, undefined);
  // The fit page lands: a new key, gaps and form are reused, answers are drafted.
  const keyBefore = postingIdempotencyKey(saved);
  const reportId = await saveReport({ job_title: "Engineering Manager", company: "Synthetic Co", job_description: saved.jobDescription, pitch: "Strong fit." });
  saved = await mutateJob(job.id, () => ({ fitReportId: reportId }));
  assert.notEqual(postingIdempotencyKey(saved), keyBefore);
  result = await withSettingsSnapshot(enabled, () => executePostingCheck({ jobId: job.id }, { ...deps,
    evaluate: async () => { throw new Error("gaps are reused"); }, fetchForm: async () => { throw new Error("form is reused"); } }));
  assert.equal(result.outcome, "checked"); assert.equal(result.drafted, 2);
  // Personal questions never reach the writer.
  assert.deepEqual(calls.map(c => c.question), ["Why do you want to work at Synthetic Co?", "Describe a system you scaled. (Max 200 words)"]);
  assert.equal(calls[0].economy, true); assert.equal(calls[0].limit, 150); assert.ok(calls[0].report?.pitch);
  assert.deepEqual(calls[1].previous, [{ q: "Why do you want to work at Synthetic Co?", a: "Draft for: Why do you want to work at Synthetic Co?" }]);
  saved = await getJob(job.id);
  const [why, rtw, salary, describe] = saved.postingCheck.form.questions;
  assert.deepEqual([why.state, why.needsYou, why.answerDraft], ["drafted", false, "Draft for: Why do you want to work at Synthetic Co?"]);
  assert.deepEqual([rtw.state, rtw.needsYou], ["drafted", true]);
  assert.match(rtw.answerDraft, /Settled Status/); assert.match(rtw.reason, /Right to work/);
  assert.deepEqual([salary.state, salary.needsYou, salary.answerDraft], ["pending", true, ""]);
  assert.deepEqual([describe.state, describe.needsYou, describe.reason], ["pending", true, "It needs a specific scaling example."]);
  assert.equal(saved.postingCheck.draftStatus, "drafted");
  // Nothing was submitted or saved as an application question yet.
  assert.deepEqual(saved.questions, []);
  // The same inputs again: nothing to do, and a refused question is not redrafted.
  assert.equal((await withSettingsSnapshot(enabled, () => executePostingCheck({ jobId: job.id }, { ...deps,
    evaluate: async () => { throw new Error("no"); }, fetchForm: async () => { throw new Error("no"); }, answer: async () => { throw new Error("no"); } }))).outcome, "already-checked");
  // Re-run: everything is checked again; the refused question is retried, approved states survive.
  await mutateJob(job.id, current => ({ postingCheck: { ...current.postingCheck, form: { ...current.postingCheck.form,
    questions: current.postingCheck.form.questions.map(q => q.id === why.id ? { ...q, state: "approved" } : q) } } }));
  calls.length = 0;
  result = await withSettingsSnapshot(enabled, () => executePostingCheck({ jobId: job.id, force: true }, deps));
  assert.equal(result.outcome, "checked");
  assert.deepEqual(calls.map(c => c.question), ["Describe a system you scaled. (Max 200 words)"]);
  assert.equal((await getJob(job.id)).postingCheck.form.questions[0].state, "approved");
});

await test("a failed Jev check or form read still saves the rest as partial", async () => {
  const job = await create({ fitReportId: await saveReport({ job_title: "EM", company: "Synthetic Co", job_description: "x", pitch: "p" }) });
  const result = await withSettingsSnapshot(enabled, () => executePostingCheck({ jobId: job.id }, {
    fetchForm: async () => { throw new Error("Greenhouse down"); }, answer: stubAnswer([]),
    evaluate: async () => { throw new Error("Jev down"); }, write: async () => { throw new Error("must not write"); } }));
  assert.equal(result.outcome, "checked");
  const saved = await getJob(job.id);
  assert.equal(saved.postingCheck.status, "partial"); assert.equal(saved.postingCheck.gapStatus, "unavailable");
  assert.deepEqual(saved.postingCheck.gaps, []); assert.equal(saved.postingCheck.form.status, "unavailable");
  // A failed note keeps the templated text; an incomplete Jev answer counts as unavailable.
  const other = await create();
  await withSettingsSnapshot(enabled, () => executePostingCheck({ jobId: other.id }, { fetchForm: stubFetch, answer: stubAnswer([]),
    evaluate: async () => jevAnswers({ salary: 0.1, location: 0.9, seniority: 0.9, contract: 0.9 }), write: async () => { throw new Error("OpenAI down"); } }));
  assert.deepEqual((await getJob(other.id)).postingCheck.gaps.map(g => [g.kind, g.why]), [["salary", GAP_TEMPLATES.salary.why]]);
  const third = await create({ sourceUrl: "https://example.com/careers/1" });
  await withSettingsSnapshot(enabled, () => executePostingCheck({ jobId: third.id }, { fetchForm: stubFetch, answer: stubAnswer([]),
    evaluate: async () => jevAnswers({ salary: 0.9 }), write: async () => ({ notes: {} }) }));
  const thirdCheck = (await getJob(third.id)).postingCheck;
  assert.equal(thirdCheck.gapStatus, "unavailable"); assert.equal(thirdCheck.form.status, "not-detected");
});

await test("a check is dropped when the job leaves Reviewing, and keeps what Bernardo did meanwhile", async () => {
  const job = await create();
  const result = await withSettingsSnapshot(enabled, () => executePostingCheck({ jobId: job.id }, { fetchForm: stubFetch, answer: stubAnswer([]),
    write: async () => ({ notes: {} }),
    evaluate: async () => { await mutateJob(job.id, () => ({ stage: "applied" })); return jevAnswers({ salary: 0.1, location: 0.1, seniority: 0.1, contract: 0.1 }); } }));
  assert.equal(result.outcome, "superseded");
  assert.equal((await getJob(job.id)).postingCheck, null);
  const next = { gaps: gapsFromKinds(["salary", "location"]), form: { source: "greenhouse", questions: [{ id: "q1", state: "drafted", answerDraft: "new" }, { id: "q2", state: "drafted", answerDraft: "x" }] } };
  const merged = carryUserStates(next, { gaps: [{ id: "salary", state: "dismissed" }, { id: "location", state: "asked", question: "Mine?" }],
    form: { source: "greenhouse", questions: [{ id: "q1", state: "approved", answerDraft: "edited" }] } });
  assert.deepEqual(merged.gaps.map(g => [g.id, g.state, g.question]), [["salary", "dismissed", GAP_TEMPLATES.salary.question], ["location", "asked", "Mine?"]]);
  assert.deepEqual(merged.form.questions.map(q => [q.id, q.state, q.answerDraft]), [["q1", "approved", "edited"], ["q2", "drafted", "x"]]);
});

await test("idempotency key: per job, posting, fit page, pasted questions and policy", async () => {
  const job = { id: "j1", stage: "reviewing", jobDescription: "JD", salary: "", location: "Leeds", locationMode: "", sourceUrl: GH_URL };
  const key = postingIdempotencyKey(job);
  assert.equal(key, `check-posting:j1:${postingFingerprint(job)}:nofit:ats:${POSTING_CHECK_POLICY}`);
  assert.equal(postingIdempotencyKey({ ...job, notes: "changed notes" }), key);
  assert.notEqual(postingIdempotencyKey({ ...job, jobDescription: "JD v2" }), key);
  assert.notEqual(postingIdempotencyKey({ ...job, salary: "£100k" }), key);
  assert.match(postingIdempotencyKey({ ...job, fitReportId: "r1" }), /:fit:ats:/);
  const pasted = postingActionPatch(job, { action: "paste-questions", text: "Why us?" }).postingCheck;
  assert.doesNotMatch(postingIdempotencyKey({ ...job, postingCheck: pasted }), /:ats:/);
  const triggered = [];
  const trigger = async (id, k, payload) => { triggered.push([id, k, payload]); return { id: "run_1" }; };
  assert.deepEqual(await withSettingsSnapshot(disabled, () => requestPostingCheck(job, { trigger })), { requested: false });
  assert.deepEqual(await withSettingsSnapshot(enabled, () => requestPostingCheck({ ...job, stage: "new" }, { trigger })), { requested: false });
  assert.deepEqual(await withSettingsSnapshot(enabled, () => requestPostingCheck({ ...job, archived: true }, { trigger })), { requested: false });
  assert.deepEqual(await withSettingsSnapshot(enabled, () => requestPostingCheck(job, { trigger })), { requested: true, runId: "run_1" });
  assert.deepEqual(triggered[0], ["j1", key, { jobId: "j1" }]);
  await withSettingsSnapshot(enabled, () => requestPostingCheck(job, { trigger, force: true }));
  assert.match(triggered[1][1], new RegExp(`^${key}:rerun:`)); assert.deepEqual(triggered[1][2], { jobId: "j1", force: true });
  const failure = await withSettingsSnapshot(enabled, () => requestPostingCheck(job, { trigger: async () => { throw new Error("Trigger down"); } }));
  assert.equal(failure.requested, false); assert.match(failure.error, /Trigger down/);
});

const checked = (extra = {}) => ({
  status: "checked", fingerprint: "f", policy: POSTING_CHECK_POLICY, checkedAt: "2026-10-29T09:00:00.000Z", gapStatus: "checked", draftStatus: "drafted",
  gaps: gapsFromKinds(["salary", "contract"]),
  form: { source: "greenhouse", url: GH_URL, status: "ready", questions: [
    { id: "q1", text: "Why us?", required: true, options: [], limit: 150, answerDraft: "Because.", needsYou: false, reason: "", state: "drafted" },
    { id: "q2", text: "Salary expectation?", required: true, options: [], limit: 60, answerDraft: "", needsYou: true, reason: "Salary expectation: only you can set this.", state: "pending" },
    { id: "q3", text: "Later question?", required: false, options: [], limit: 120, answerDraft: "", needsYou: false, reason: "", state: "pending" },
  ] }, ...extra });

await test("needs-you lists open gaps and answers to approve beside unchanged review items", () => {
  const review = { lean: "ask", advanceProbability: 0.5, dropProbability: 0.3, reason: "R.", question: "Q?", reviewedAt: "t", model: "jev", examples: 1 };
  const items = needsYouItems([
    { id: "n1", stage: "new", company: "New Co", role: "EM", jevAssessment: { score: 70 }, agentReview: review },
    { id: "r1", stage: "reviewing", company: "Rev Co", role: "EM", location: "Leeds", jevAssessment: { score: 80 }, postingCheck: checked() },
    { id: "r2", stage: "reviewing", jevAssessment: { score: 90 }, postingCheck: checked({ gaps: gapsFromKinds(["salary"]).map(g => ({ ...g, state: "dismissed" })),
      form: { source: "pasted", questions: [{ id: "q9", text: "Done?", state: "approved", answerDraft: "Yes" }] } }) },
    { id: "r3", stage: "reviewing", archived: true, postingCheck: checked() },
    { id: "r4", stage: "applied", postingCheck: checked() },
    { id: "r5", stage: "reviewing", postingCheck: null },
  ]);
  // Agent review items keep their exact shape (no kind) and come first.
  assert.deepEqual(items[0], { id: "n1", company: "New Co", role: "EM", score: 70, location: "", lean: "ask", advanceProbability: 0.5,
    dropProbability: 0.3, reason: "R.", question: "Q?", reviewedAt: "t" });
  assert.deepEqual(items.slice(1).map(i => [i.kind, i.id]), [["posting-gaps", "r1"], ["application-answers", "r1"]]);
  assert.deepEqual(items[1], { kind: "posting-gaps", id: "r1", company: "Rev Co", role: "EM", score: 80, location: "Leeds", checkedAt: "2026-10-29T09:00:00.000Z",
    gaps: [{ id: "salary", kind: "salary", ...GAP_TEMPLATES.salary }, { id: "contract", kind: "contract", ...GAP_TEMPLATES.contract }] });
  assert.deepEqual(items[2].questions.map(q => [q.id, q.needsYou]), [["q1", false], ["q2", true]]);
  assert.equal(items[2].source, "greenhouse");
  assert.deepEqual(Object.keys(items[2].questions[0]), ["id", "text", "required", "options", "answerDraft", "needsYou", "reason"]);
  assert.deepEqual(postingCheckProgress({ postingCheck: checked() }), { checked: true, status: "checked", openGaps: 2, formQuestions: 3,
    answersToApprove: 1, answersNeedingYou: 1, answersWaiting: 3, answersReady: false });
  assert.equal(postingCheckProgress({}).answersReady, true);
  assert.equal(postingCheckProgress({ postingCheck: checked({ form: { questions: [{ id: "a", text: "A?", state: "approved" }, { id: "b", text: "B?", state: "skipped" }] } }) }).answersReady, true);
});

await test("approve, edit, skip, dismiss and draft-question actions through the jobs API", async () => {
  const job = await create({ postingCheck: checked(), questions: [{ id: "own", q: "Existing?", a: "Yes." }] });
  // Approving saves the draft into the job's application questions.
  let response = await call("POST", { body: { action: "approve-answer", id: job.id, questionId: "q1" } });
  assert.equal(response.status, 200);
  let saved = await getJob(job.id);
  assert.equal(saved.postingCheck.form.questions[0].state, "approved");
  assert.deepEqual(saved.questions.map(q => [q.id, q.q, q.a]), [["own", "Existing?", "Yes."], ["pc_q1", "Why us?", "Because."]]);
  assert.equal(saved.questions[1].limit, 150);
  assert.equal(response.body.job.questions.length, 2);
  assert.equal(response.body.job.postingCheck.form.questions[0].state, "approved");
  // Editing then approving again replaces the saved answer rather than adding one.
  response = await call("POST", { body: { action: "approve-answer", id: job.id, questionId: "q1", answer: "  Because of the team.  " } });
  saved = await getJob(job.id);
  assert.deepEqual(saved.questions.map(q => [q.id, q.a]), [["own", "Yes."], ["pc_q1", "Because of the team."]]);
  // A needs-you question has no draft: approving needs his text.
  assert.equal((await call("POST", { body: { action: "approve-answer", id: job.id, questionId: "q2" } })).status, 400);
  assert.equal((await call("POST", { body: { action: "approve-answer", id: job.id, questionId: "q2", answer: "£120,000" } })).status, 200);
  assert.equal((await call("POST", { body: { action: "skip-answer", id: job.id, questionId: "q3" } })).status, 200);
  assert.equal((await call("POST", { body: { action: "approve-answer", id: job.id, questionId: "nope" } })).status, 404);
  // Gaps: dismiss one, turn the other into a recruiter question (text stored only).
  assert.equal((await call("POST", { body: { action: "dismiss-gap", id: job.id, gapId: "salary" } })).status, 200);
  response = await call("POST", { body: { action: "draft-gap-question", id: job.id, gapId: "contract", question: "Is this role permanent?" } });
  assert.equal(response.status, 200);
  saved = await getJob(job.id);
  assert.deepEqual(saved.postingCheck.gaps.map(g => [g.id, g.state, g.question]), [["salary", "dismissed", GAP_TEMPLATES.salary.question], ["contract", "asked", "Is this role permanent?"]]);
  assert.ok(saved.postingCheck.gaps[1].askedAt);
  assert.equal((await call("POST", { body: { action: "draft-gap-question", id: job.id, gapId: "contract", question: "" } })).status, 400);
  assert.equal((await call("POST", { body: { action: "dismiss-gap", id: job.id, gapId: "visa" } })).status, 404);
  assert.equal((await call("POST", { body: { action: "dismiss-gap", id: "missing", gapId: "salary" } })).status, 404);
  assert.equal((await call("POST", { body: { action: "dismiss-gap", gapId: "salary" } })).status, 400);
  // Everything handled: nothing left in Needs you, and the answers are ready.
  assert.deepEqual(postingNeedsYouItems([saved]), []);
  assert.equal(postingCheckProgress(saved).answersReady, true);
  const needs = await call("GET", { query: { needsYou: "1" } });
  assert.ok(!needs.body.items.some(item => item.id === job.id));
  assert.equal((await call("POST", { body: { action: "dismiss-gap", id: (await create()).id, gapId: "salary" } })).status, 409);
});

await test("pasted questions are saved, and re-run needs the check switched on", async () => {
  const job = await create({ sourceUrl: "https://example.com/careers/1" });
  let response = await call("POST", { body: { action: "paste-questions", id: job.id, text: "Why us?\nWhat is your notice period?" } });
  assert.equal(response.status, 200);
  // Unpublished/disabled in tests: saved, but no drafting run is requested.
  assert.equal(response.body.requested, false);
  const saved = await getJob(job.id);
  assert.equal(saved.postingCheck.form.source, "pasted");
  assert.deepEqual(saved.postingCheck.form.questions.map(q => [q.text, q.state]), [["Why us?", "pending"], ["What is your notice period?", "pending"]]);
  assert.equal((await call("POST", { body: { action: "paste-questions", id: job.id, text: "  \n" } })).status, 400);
  response = await call("POST", { body: { action: "rerun-posting-check", id: job.id } });
  assert.equal(response.status, 409); assert.match(response.body.error, /Turn on/);
  // A pasted form survives a check run and is drafted by it.
  await mutateJob(job.id, () => ({ fitReportId: "" }));
  const reportId = await saveReport({ job_title: "EM", company: "Synthetic Co", job_description: "x", pitch: "p" });
  await mutateJob(job.id, () => ({ fitReportId: reportId }));
  const calls = [];
  await withSettingsSnapshot(enabled, () => executePostingCheck({ jobId: job.id }, { answer: stubAnswer(calls),
    evaluate: async () => jevAnswers({ salary: 0.9, location: 0.9, seniority: 0.9, contract: 0.9 }), write: async () => ({ notes: {} }),
    fetchForm: async () => { throw new Error("pasted forms are not fetched"); } }));
  const after = (await getJob(job.id)).postingCheck;
  assert.equal(after.form.source, "pasted");
  assert.deepEqual(calls.map(c => c.question), ["Why us?"]);
  assert.deepEqual(after.form.questions.map(q => [q.state, q.needsYou]), [["drafted", false], ["pending", true]]);
  assert.deepEqual(after.gaps, []);
});

console.log(`passed ${passed}, failed ${failed}`);
process.exit(failed ? 1 : 0);
