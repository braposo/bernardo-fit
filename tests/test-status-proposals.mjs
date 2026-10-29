process.env.ADMIN_SECRET = "status-proposals-admin";
process.env.EMAIL_ROUTINE_SECRET = "status-proposals-routine";
import assert from "node:assert/strict";
import { DEFAULT_EMAIL_STATUS, validateEmailStatus } from "../lib/sanity/email-status-settings.js";
import { initialSettingsDocument } from "../lib/sanity/settings-document.js";
import { settingsFromDocument, withSettingsSnapshot, emailStatusSettings, ANALYSIS_SETTINGS_QUERY } from "../lib/sanity/analysis-settings.js";
import { validateProposalInput, matchEmailToJobs, parseSender, personalSender, createStatusProposal, listStatusProposals,
  statusProposalDocumentId, proposalNeedsYouItems, decideStatusProposal, resetStatusProposalsForTests, setStatusProposalClient,
  PROPOSABLE_STAGES } from "../lib/status-proposals.js";
import { validateInterviewFields, timelineView, timelineBriefInput, MAX_TIMELINE_ENTRIES, addTimelineEntry, timelineEntry } from "../lib/interview-timeline.js";
import { needsYouItems } from "../lib/review-agent.js";
import { listReviewDecisions, resetReviewDecisionsForTests } from "../lib/review-decisions.js";
import { briefInputs, briefModelInput } from "../lib/brief-inputs.js";
import { briefFingerprint } from "../lib/generation-fingerprint.js";
import { getJobAudit } from "../lib/job-audit.js";
import { jobDetail } from "../lib/job-view.js";
import { jobFields, jobFrom } from "../lib/sanity/codecs.js";
import { saveJob, getJob } from "../lib/store.js";
import handler from "../api/admin/jobs.js";

let passed = 0, failed = 0;
async function test(name, fn) {
  resetStatusProposalsForTests();
  resetReviewDecisionsForTests();
  setStatusProposalClient(null);
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.error("  FAIL " + name, e); }
}
const ADMIN = { "x-admin-secret": "status-proposals-admin" };
const ROUTINE = { "x-routine-secret": "status-proposals-routine" };
function call(method, { query = {}, body, headers = ADMIN } = {}) {
  return new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; }, json(data) { resolve({ status: this.statusCode, body: data }); return this; } };
    handler({ method, query, body, headers }, res);
  });
}

const enabled = settingsFromDocument({ ...initialSettingsDocument(), emailStatusProposals: { enabled: true, minimumConfidence: 0.6 } });
const disabled = settingsFromDocument(initialSettingsDocument());
const unpublished = settingsFromDocument({ ...initialSettingsDocument(), emailStatusProposals: undefined });
const asEnabled = run => withSettingsSnapshot(enabled, run);
const routinePost = (body, headers = ROUTINE) => call("POST", { query: { routine: "proposal" }, body, headers });

const create = extra => saveJob({ company: "Lead Forensics Ltd", role: "Engineering Manager", location: "Remote UK",
  jobDescription: "Lead a team.", stage: "applied", ...extra });
const proposalBody = (jobId, extra = {}) => ({ jobId, proposedStage: "rejected", confidence: 0.9, matchedBy: "company",
  summary: "Lead Forensics: rejection email on 27 Oct, move to Rejected?",
  email: { threadId: "t-100", messageId: "m-100", subject: "Your application to Lead Forensics", from: "Jane Smith <jane@leadforensics.com>",
    date: "2026-10-27T09:30:00Z", link: "https://mail.google.com/mail/u/0/#all/t-100" }, ...extra });
const interview = { date: "2026-11-03T14:00:00Z", round: "Round 2: hiring manager", kind: "video" };

await test("settings validate, are seeded disabled and stay out of the scoring fingerprint", () => {
  assert.equal(DEFAULT_EMAIL_STATUS.enabled, false);
  assert.equal(DEFAULT_EMAIL_STATUS.minimumConfidence, 0.6);
  assert.equal(DEFAULT_EMAIL_STATUS.gmailCheck.enabled, false);
  // Documents published before gmailCheck existed stay valid; the Gmail check is then off.
  assert.deepEqual(validateEmailStatus({ enabled: true, minimumConfidence: 0.7 }), { enabled: true, minimumConfidence: 0.7, gmailCheck: null });
  assert.deepEqual(validateEmailStatus({ ...DEFAULT_EMAIL_STATUS, extra: 1 }), DEFAULT_EMAIL_STATUS);
  for (const patch of [{ enabled: "yes" }, { minimumConfidence: 0.2 }, { minimumConfidence: 1 }, { minimumConfidence: "0.7" }, { minimumConfidence: NaN }])
    assert.throws(() => validateEmailStatus({ ...DEFAULT_EMAIL_STATUS, ...patch }), /email status proposal settings/);
  for (const bad of [null, [], "x"]) assert.throws(() => validateEmailStatus(bad), /email status proposal settings/);
  assert.match(ANALYSIS_SETTINGS_QUERY, /emailStatusProposals/);
  assert.deepEqual(initialSettingsDocument().emailStatusProposals, DEFAULT_EMAIL_STATUS);
  assert.equal(enabled.fingerprint, disabled.fingerprint);
  assert.equal(enabled.fingerprint, unpublished.fingerprint);
  withSettingsSnapshot(unpublished, () => assert.equal(emailStatusSettings(), null));
  asEnabled(() => assert.equal(emailStatusSettings().enabled, true));
  assert.equal(emailStatusSettings().enabled, false);
});

await test("proposal input is validated strictly", () => {
  const clean = validateProposalInput({ ...proposalBody("j1"), interview, unknown: "ignored" });
  assert.equal(clean.jobId, "j1"); assert.equal(clean.proposedStage, "rejected");
  assert.equal(clean.email.fromAddress, "jane@leadforensics.com");
  assert.equal(clean.email.date, "2026-10-27T09:30:00.000Z");
  assert.deepEqual(clean.interview, { ...interview, notes: "" });
  assert.equal("unknown" in clean, false);
  assert.ok(!PROPOSABLE_STAGES.includes("new"));
  const bad = [
    { proposedStage: "new" }, { proposedStage: "maybe" }, { jobId: "" }, { summary: " " }, { summary: "x".repeat(301) },
    { confidence: 1.2 }, { confidence: "0.9" }, { matchedBy: "guess" }, { email: null },
    { email: { ...proposalBody("j").email, messageId: "" } }, { email: { ...proposalBody("j").email, threadId: undefined } },
    { email: { ...proposalBody("j").email, date: "yesterday" } }, { email: { ...proposalBody("j").email, link: "https://evil.test/x" } },
    { email: { ...proposalBody("j").email, from: "" } },
    { interview: { ...interview, date: "3 Nov" } }, { interview: { ...interview, kind: "dinner" } }, { interview: { ...interview, round: "" } },
  ];
  for (const patch of bad) assert.throws(() => validateProposalInput({ ...proposalBody("j1"), ...patch }), e => e.status === 400, JSON.stringify(patch));
  assert.equal(validateProposalInput(proposalBody("j1", { proposedStage: "not_a_fit" })).proposedStage, "not_interested");
});

await test("senders parse, and robots and shared domains are not remembered", () => {
  assert.deepEqual(parseSender("\"Jane Smith\" <Jane@LeadForensics.com>"), { name: "Jane Smith", address: "jane@leadforensics.com" });
  assert.deepEqual(parseSender("jobs@acme.io"), { name: "", address: "jobs@acme.io" });
  assert.deepEqual(parseSender("nobody"), { name: "nobody", address: "" });
  assert.equal(personalSender("jane@acme.io"), true);
  assert.equal(personalSender("no-reply@greenhouse.io"), false);
  assert.equal(personalSender("notifications+abc@acme.io"), false);
});

await test("emails match jobs by thread, recruiter, domain and company", () => {
  const jobs = [
    { id: "lf", company: "Lead Forensics Ltd", role: "EM", stage: "applied" },
    { id: "acme", company: "Acme", role: "Head of Eng", stage: "interviewing", emailThreadIds: ["t-9"], emailSenders: ["sam@talentco.com"] },
    { id: "rec", company: "Globex", role: "EM", stage: "applied", recruiter: { name: "Pat Jones", org: "Hirers" } },
    { id: "old", company: "Lead Forensics", role: "Old EM", stage: "rejected", archived: true },
    { id: "gh", company: "Greenhouse", role: "EM", stage: "applied" },
  ];
  assert.deepEqual(matchEmailToJobs(jobs, { threadId: "t-9" }).map(c => [c.id, c.matchedBy]), [["acme", "thread"]]);
  assert.deepEqual(matchEmailToJobs(jobs, { from: "Sam <sam@talentco.com>" }).map(c => [c.id, c.matchedBy]), [["acme", "recruiter"]]);
  assert.deepEqual(matchEmailToJobs(jobs, { from: "Pat Jones <pat@gmail.com>" }).map(c => [c.id, c.matchedBy]), [["rec", "recruiter"]]);
  const lf = matchEmailToJobs(jobs, { from: "Jane <jane@mail.leadforensics.com>", subject: "Update on your Lead Forensics application" });
  assert.deepEqual(lf.map(c => c.id), ["lf", "old"]);
  assert.deepEqual(lf[0].signals, ["domain", "company"]);
  assert.equal(lf[0].matchedBy, "domain");
  assert.ok(lf[0].score > lf[1].score);
  assert.equal(lf[1].archived, true);
  // ATS and mailbox domains never match a company by domain.
  assert.deepEqual(matchEmailToJobs(jobs, { from: "no-reply@greenhouse.io", subject: "Thanks for applying" }), []);
  assert.deepEqual(matchEmailToJobs(jobs, { from: "no-reply@greenhouse.io", subject: "Thanks for applying to Acme" }).map(c => [c.id, c.matchedBy]), [["acme", "company"]]);
  assert.deepEqual(matchEmailToJobs(jobs, { company: "Globex Corporation" }).map(c => c.id), ["rec"]);
  assert.deepEqual(matchEmailToJobs(jobs, {}), []);
});

await test("the routine endpoint has its own secret and cannot reach the admin API", async () => {
  const job = await create();
  assert.equal((await call("GET", { query: { routine: "match", subject: "Lead Forensics" }, headers: {} })).status, 401);
  assert.equal((await call("GET", { query: { routine: "match", subject: "Lead Forensics" }, headers: { "x-routine-secret": "wrong" } })).status, 401);
  const match = await call("GET", { query: { routine: "match", subject: "Your Lead Forensics application" }, headers: ROUTINE });
  assert.equal(match.status, 200);
  assert.ok(match.body.candidates.some(c => c.id === job.id && c.matchedBy === "company"));
  assert.equal((await call("GET", { query: { routine: "match", subject: "Lead Forensics" } })).status, 200);
  assert.equal((await call("GET", { query: { routine: "match" }, headers: ROUTINE })).status, 400);
  assert.equal((await call("GET", { query: {}, headers: ROUTINE })).status, 401);
  assert.equal((await call("GET", { query: { proposals: "1" }, headers: ROUTINE })).status, 401);
  assert.equal((await call("POST", { body: { action: "apply-proposal", id: "x" }, headers: ROUTINE })).status, 401);
  assert.equal((await call("DELETE", { query: { routine: "proposal" }, headers: ROUTINE })).status, 405);
});

await test("proposals are refused while disabled or unpublished", async () => {
  const job = await create();
  const off = await routinePost(proposalBody(job.id));
  assert.equal(off.status, 403); assert.match(off.body.error, /disabled/);
  const none = await withSettingsSnapshot(unpublished, () => routinePost(proposalBody(job.id)));
  assert.equal(none.status, 403);
  assert.deepEqual(await listStatusProposals({ state: "all" }), []);
});

await test("create validates, dedupes by message and job, and skips low confidence and no-op moves", async () => {
  const job = await create();
  const first = await asEnabled(() => routinePost(proposalBody(job.id)));
  assert.equal(first.status, 201);
  assert.equal(first.body.created, true);
  assert.equal(first.body.proposal.id, statusProposalDocumentId(job.id, "m-100"));
  assert.equal(first.body.proposal.state, "open");
  assert.equal(first.body.proposal.currentStage, "applied");
  assert.equal(first.body.proposal.company, "Lead Forensics Ltd");
  const again = await asEnabled(() => routinePost(proposalBody(job.id, { summary: "Second run" })));
  assert.equal(again.status, 200);
  assert.deepEqual([again.body.created, again.body.reason, again.body.proposal.summary], [false, "duplicate", first.body.proposal.summary]);
  const low = await asEnabled(() => routinePost(proposalBody(job.id, { confidence: 0.4, email: { ...proposalBody(job.id).email, messageId: "m-101" } })));
  assert.deepEqual([low.status, low.body.reason], [200, "low-confidence"]);
  const same = await asEnabled(() => routinePost(proposalBody(job.id, { proposedStage: "applied", email: { ...proposalBody(job.id).email, messageId: "m-102" } })));
  assert.deepEqual([same.status, same.body.reason], [200, "already-at-stage"]);
  // The same stage with an interview is a new round worth recording.
  const round = await asEnabled(() => routinePost(proposalBody(job.id, { proposedStage: "applied", interview, email: { ...proposalBody(job.id).email, messageId: "m-103" } })));
  assert.equal(round.status, 201);
  assert.equal((await asEnabled(() => routinePost(proposalBody("missing")))).status, 404);
  const invalid = await asEnabled(() => routinePost(proposalBody(job.id, { proposedStage: "new" })));
  assert.equal(invalid.status, 400);
  assert.equal((await listStatusProposals({ state: "open" })).length, 2);
  const listed = await call("GET", { query: { proposals: "1", jobId: job.id } });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.proposals.map(p => p.email.messageId).sort(), ["m-100", "m-103"]);
  assert.equal((await call("GET", { query: { proposals: "1", state: "weird" } })).status, 400);
});

await test("apply moves the stage through the PATCH path and adds the interview round", async () => {
  const job = await create({ stage: "new" });
  const proposal = (await asEnabled(() => routinePost(proposalBody(job.id, { proposedStage: "interviewing", interview,
    summary: "Lead Forensics: interview invite for 3 Nov, move to Interviewing?" })))).body.proposal;
  const applied = await call("POST", { body: { action: "apply-proposal", id: proposal.id } });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.proposal.state, "applied");
  assert.equal(applied.body.proposal.appliedFromStage, "new");
  assert.ok(applied.body.proposal.decidedAt);
  assert.equal(applied.body.job.stage, "interviewing");
  const saved = await getJob(job.id);
  assert.equal(saved.stage, "interviewing");
  assert.deepEqual(saved.emailThreadIds, ["t-100"]);
  assert.deepEqual(saved.emailSenders, ["jane@leadforensics.com"]);
  const [entry] = timelineView(saved.interviewTimeline);
  assert.deepEqual({ ...entry, id: undefined, createdAt: undefined, updatedAt: undefined },
    { id: undefined, date: interview.date, round: interview.round, kind: "video", source: "email", notes: "", proposalId: proposal.id, createdAt: undefined, updatedAt: undefined });
  // Same side effects as a manual move: the audit entry and the review decision for leaving New.
  const audit = await getJobAudit(saved);
  assert.ok(audit.events.some(e => e.type === "status.changed" && e.detail === "new → interviewing"));
  assert.ok(audit.events.some(e => e.type === "interview.added" && e.title === "Interview added from email"));
  const [decision] = await listReviewDecisions();
  assert.deepEqual([decision.jobId, decision.toStage, decision.direction], [job.id, "interviewing", "advance"]);
  // Once decided, a proposal cannot be applied or dismissed again.
  assert.equal((await call("POST", { body: { action: "apply-proposal", id: proposal.id } })).status, 409);
  assert.equal((await call("POST", { body: { action: "dismiss-proposal", id: proposal.id } })).status, 409);
  assert.equal((await call("POST", { body: { action: "apply-proposal", id: "status-proposal.nope" } })).status, 404);
  assert.equal((await call("POST", { body: { action: "apply-proposal" } })).status, 400);
  // Later email on the same thread now matches this job by thread.
  assert.equal(matchEmailToJobs([saved], { threadId: "t-100" })[0].matchedBy, "thread");
});

await test("apply to Rejected archives like a manual move; a same-stage round leaves the stage alone", async () => {
  const job = await create();
  const reject = (await asEnabled(() => routinePost(proposalBody(job.id)))).body.proposal;
  const applied = await call("POST", { body: { action: "apply-proposal", id: reject.id } });
  assert.equal(applied.status, 200);
  const saved = await getJob(job.id);
  assert.deepEqual([saved.stage, saved.archived], ["rejected", true]);
  assert.deepEqual(saved.interviewTimeline, []);
  assert.deepEqual(await listReviewDecisions(), []);

  const live = await create({ stage: "interviewing", company: "Acme" });
  const round = (await asEnabled(() => routinePost(proposalBody(live.id, { proposedStage: "interviewing", interview,
    email: { ...proposalBody(live.id).email, threadId: "t-200", messageId: "m-200", from: "no-reply@greenhouse.io" } })))).body.proposal;
  const before = await getJob(live.id);
  assert.equal((await call("POST", { body: { action: "apply-proposal", id: round.id } })).status, 200);
  const after = await getJob(live.id);
  assert.equal(after.stage, "interviewing");
  assert.equal(after.updatedAt >= before.updatedAt, true);
  assert.equal(timelineView(after.interviewTimeline).length, 1);
  assert.deepEqual(after.emailThreadIds, ["t-200"]);
  // A shared robot sender is not learned.
  assert.deepEqual(after.emailSenders, []);
  const audit = await getJobAudit(after);
  assert.equal(audit.events.some(e => e.type === "status.changed"), false);
});

await test("dismiss only marks the proposal", async () => {
  const job = await create();
  const proposal = (await asEnabled(() => routinePost(proposalBody(job.id, { interview })))).body.proposal;
  const before = await getJob(job.id);
  const dismissed = await call("POST", { body: { action: "dismiss-proposal", id: proposal.id } });
  assert.equal(dismissed.status, 200);
  assert.equal(dismissed.body.proposal.state, "dismissed");
  assert.equal(dismissed.body.proposal.appliedFromStage, "");
  const after = await getJob(job.id);
  assert.deepEqual(after, before);
  assert.deepEqual((await listStatusProposals({ state: "dismissed" })).map(p => p.id), [proposal.id]);
  assert.deepEqual(await listStatusProposals(), []);
});

await test("open proposals appear in Needs you with their own kind, after review items", async () => {
  const review = { lean: "ask", advanceProbability: 0.5, dropProbability: 0.3, reason: "Unclear.", question: "Worth a look?", reviewedAt: "2026-10-28T09:00:00.000Z" };
  const jobs = [{ id: "n1", stage: "new", company: "New Co", role: "EM", jevAssessment: { score: 70 }, agentReview: review },
    { id: "a1", stage: "applied", company: "Applied Co", role: "Head", archived: false },
    { id: "r1", stage: "rejected", company: "Closed Co", role: "EM", archived: true }];
  const proposal = (id, jobId, createdAt, state = "open") => ({ id, jobId, state, company: "Snapshot", role: "Snapshot", proposedStage: "interviewing",
    summary: `Summary ${id}`, interview: null, confidence: 0.8, matchedBy: "thread", createdAt,
    email: { threadId: "t", messageId: id, subject: "Subject", from: "a@b.co", date: "2026-10-27T09:00:00.000Z", link: "" } });
  const proposals = [proposal("p1", "a1", "2026-10-27T10:00:00Z"), proposal("p2", "r1", "2026-10-28T10:00:00Z"),
    proposal("p3", "gone", "2026-10-29T10:00:00Z"), proposal("p4", "a1", "2026-10-29T11:00:00Z", "applied")];
  const items = needsYouItems(jobs, { proposals });
  // Existing items keep their shape and order; no proposals means no change.
  assert.deepEqual(needsYouItems(jobs), items.slice(0, 1));
  assert.equal("kind" in items[0], false);
  assert.deepEqual(items.slice(1).map(i => i.id), ["p2", "p1"]);
  assert.deepEqual(items[2], { kind: "status-proposal", id: "p1", jobId: "a1", company: "Applied Co", role: "Head", stage: "applied",
    proposedStage: "interviewing", summary: "Summary p1", interview: null, confidence: 0.8, matchedBy: "thread",
    email: { subject: "Subject", from: "a@b.co", date: "2026-10-27T09:00:00.000Z", link: "" }, createdAt: "2026-10-27T10:00:00Z" });
  assert.deepEqual(proposalNeedsYouItems(proposals, []), []);

  const job = await create();
  await asEnabled(() => routinePost(proposalBody(job.id)));
  const response = await call("GET", { query: { needsYou: "1" } });
  assert.equal(response.status, 200);
  assert.ok(response.body.items.some(i => i.kind === "status-proposal" && i.jobId === job.id && i.proposedStage === "rejected"));
  const list = await call("GET");
  assert.equal(list.body.needsYouCount, response.body.items.length);
});

await test("timeline entries are added, edited and removed by hand", async () => {
  const job = await create({ stage: "interviewing", briefFingerprint: "brief-current" });
  const added = await call("POST", { body: { action: "timeline-add", id: job.id, entry: { date: "2026-11-05", round: "Panel", kind: "onsite", notes: "Bring the portfolio." } } });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const [entry] = added.body.interviewTimeline;
  assert.deepEqual([entry.date, entry.round, entry.kind, entry.source, entry.notes, entry.proposalId], ["2026-11-05", "Panel", "onsite", "manual", "Bring the portfolio.", ""]);
  assert.equal((await getJob(job.id)).briefFingerprint, "");
  const earlier = await call("POST", { body: { action: "timeline-add", id: job.id, entry: { date: "2026-11-01T10:00:00Z", round: "Screen" } } });
  assert.deepEqual(earlier.body.interviewTimeline.map(e => [e.round, e.kind]), [["Screen", "other"], ["Panel", "onsite"]]);
  const edited = await call("POST", { body: { action: "timeline-edit", id: job.id, entryId: entry.id, entry: { notes: "Went well; ask about on-call." } } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.interviewTimeline.find(e => e.id === entry.id).notes, "Went well; ask about on-call.");
  assert.equal(edited.body.interviewTimeline.find(e => e.id === entry.id).round, "Panel");
  const detail = await call("GET", { query: { id: job.id } });
  assert.equal(detail.body.job.interviewTimeline.length, 2);
  const audit = await getJobAudit(await getJob(job.id));
  assert.ok(audit.events.some(e => e.type === "interview.updated"));
  for (const body of [{ action: "timeline-add", id: job.id, entry: { date: "soon", round: "X" } },
    { action: "timeline-add", id: job.id, entry: { date: "2026-11-05", round: "" } },
    { action: "timeline-add", id: job.id, entry: { date: "2026-11-05", round: "X", notes: "x".repeat(4001) } },
    { action: "timeline-edit", id: job.id, entryId: entry.id, entry: {} },
    { action: "timeline-edit", id: job.id, entryId: entry.id, entry: { kind: "lunch" } },
    { action: "timeline-edit", id: job.id, entry: { notes: "x" } }])
    assert.equal((await call("POST", { body })).status, 400, JSON.stringify(body));
  assert.equal((await call("POST", { body: { action: "timeline-edit", id: job.id, entryId: "nope", entry: { notes: "x" } } })).status, 404);
  assert.equal((await call("POST", { body: { action: "timeline-add", id: "missing", entry: { date: "2026-11-05", round: "X" } } })).status, 404);
  const removed = await call("POST", { body: { action: "timeline-remove", id: job.id, entryId: entry.id } });
  assert.deepEqual(removed.body.interviewTimeline.map(e => e.round), ["Screen"]);
  assert.ok((await getJobAudit(await getJob(job.id))).events.some(e => e.type === "interview.removed"));
});

await test("the timeline is capped, idempotent per proposal and survives the Sanity codec", () => {
  const entries = Array.from({ length: MAX_TIMELINE_ENTRIES }, (_, i) => timelineEntry({ date: "2026-11-01", round: `R${i}` }, { id: `e${i}` }));
  assert.throws(() => addTimelineEntry({ interviewTimeline: entries }, timelineEntry({ date: "2026-11-02", round: "One more" })), e => e.status === 400);
  const fromEmail = timelineEntry(interview, { source: "email", proposalId: "status-proposal.x", id: "email-x" });
  const once = addTimelineEntry({}, fromEmail);
  assert.equal(addTimelineEntry(once, { ...fromEmail, id: "other" }), undefined);
  assert.equal(validateInterviewFields({ date: "2026-11-03T14:00+01:00", round: "R" }).kind, "other");
  const job = { id: "codec", company: "A", interviewTimeline: once.interviewTimeline, emailThreadIds: ["t1"], emailSenders: ["a@b.co"] };
  const doc = { _id: "job-codec", _rev: "r1", ...jobFields(job) };
  const back = jobFrom(doc);
  assert.deepEqual([back.interviewTimeline, back.emailThreadIds, back.emailSenders], [once.interviewTimeline, ["t1"], ["a@b.co"]]);
  assert.deepEqual(jobDetail({ ...back, questions: [] }).interviewTimeline, timelineView(once.interviewTimeline));
});

await test("the interview brief reads timeline notes beside the private notes", () => {
  const report = { pitch: "p", categories: [], differentiators: [] };
  const job = { id: "b", role: "EM", company: "Acme", notes: "Recruiter: salary discussed 120k", questions: [] };
  const plain = briefInputs(job, report, null);
  assert.equal("interviews" in plain.conversation, false);
  const withTimeline = { ...job, interviewTimeline: [
    { id: "2", date: "2026-11-05", round: "Panel", kind: "onsite", source: "manual", notes: "Ask about on-call.", proposalId: "", createdAt: "b" },
    { id: "1", date: "2026-11-01", round: "Screen", kind: "phone", source: "email", notes: "", proposalId: "status-proposal.x", createdAt: "a" }] };
  const input = briefModelInput(withTimeline, report, null);
  assert.equal(input.conversation.notes, "Recruiter: salary discussed 120k");
  assert.deepEqual(input.conversation.interviews, [
    { date: "2026-11-01", round: "Screen", kind: "phone", notes: "" },
    { date: "2026-11-05", round: "Panel", kind: "onsite", notes: "Ask about on-call." }]);
  assert.deepEqual(timelineBriefInput(withTimeline.interviewTimeline), input.conversation.interviews);
  // Jobs without a timeline keep their brief fingerprint; notes edits change it.
  assert.equal(briefFingerprint(job, report, null), briefFingerprint({ ...job, interviewTimeline: [] }, report, null));
  const edited = structuredClone(withTimeline); edited.interviewTimeline[0].notes = "Different.";
  assert.notEqual(briefFingerprint(withTimeline, report, null), briefFingerprint(edited, report, null));
});

await test("with Sanity storage, creates are idempotent and decisions are revision guarded", async () => {
  const docs = new Map(), calls = [];
  const fake = {
    async fetch(query, params) { calls.push(["fetch", params]);
      if (params.id) return docs.has(params.id) ? { ...docs.get(params.id) } : null;
      return [...docs.values()].filter(d => !params.state || params.state === "all" || d.state === params.state); },
    async createIfNotExists(doc) { calls.push(["create", doc._id]); if (!docs.has(doc._id)) docs.set(doc._id, { ...doc, _rev: "r1" }); return { ...docs.get(doc._id) }; },
    patch(id) { const ops = {}; return { ifRevisionId(rev) { ops.rev = rev; return this; }, set(fields) { ops.fields = fields; return this; },
      async commit() { calls.push(["patch", id, ops.rev]); const doc = docs.get(id);
        if (doc._rev !== ops.rev) throw Object.assign(new Error("conflict"), { statusCode: 409 });
        docs.set(id, { ...doc, ...ops.fields, _rev: "r2" }); return { ...docs.get(id) }; } }; },
  };
  setStatusProposalClient(fake);
  const job = { id: "sj", company: "Acme", role: "EM", stage: "applied" };
  const settings = { enabled: true, minimumConfidence: 0.6 };
  const first = await createStatusProposal(proposalBody("sj"), { job, settings });
  assert.equal(first.created, true);
  assert.equal(docs.get(first.proposal.id)._type, "statusProposal");
  assert.equal(docs.get(first.proposal.id).job, undefined);
  const second = await createStatusProposal(proposalBody("sj"), { job, settings });
  assert.deepEqual([second.created, second.reason], [false, "duplicate"]);
  assert.equal(calls.filter(c => c[0] === "create").length, 1);
  const decided = await decideStatusProposal(first.proposal.id, "dismissed");
  assert.equal(decided.state, "dismissed");
  assert.deepEqual(calls.find(c => c[0] === "patch"), ["patch", first.proposal.id, "r1"]);
  await assert.rejects(decideStatusProposal(first.proposal.id, "applied"), e => e.status === 409);
  await assert.rejects(decideStatusProposal(first.proposal.id, "open"), e => e.status === 400);
});

console.log(`passed ${passed}, failed ${failed}`);
process.exit(failed ? 1 : 0);
