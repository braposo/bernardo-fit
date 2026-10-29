// Email status proposals. A daily Claude routine reads Bernardo's recruiting
// email, matches each message to a job and proposes a stage change (and, for
// an invitation, an interview round). Stored in Sanity as `statusProposal`
// documents. Nothing changes until Bernardo applies one: Apply goes through
// the jobs PATCH path (same audit and side effects as a manual move), Dismiss
// only marks it. See docs/email-status-routine.md.
import { createHash } from "node:crypto";
import { createStorageClient, sanityStorageEnabled } from "./sanity/client.js";
import { metadata } from "./sanity/codecs.js";
import { JOB_STAGES, normaliseJobStage } from "./store.js";
import { companyKey } from "./job-duplicates.js";
import { validateInterviewFields, addTimelineEntry, timelineEntry } from "./interview-timeline.js";

export const STATUS_PROPOSAL_TYPE = "statusProposal";
export const PROPOSAL_STATES = ["open", "applied", "dismissed"];
export const MATCHED_BY = ["thread", "recruiter", "domain", "company"];
// Email can move a job forward or close it, never back to New.
export const PROPOSABLE_STAGES = JOB_STAGES.filter(stage => stage !== "new");
export const PROPOSAL_SUMMARY_MAX_LENGTH = 300;
export const NEEDS_YOU_PROPOSAL_KIND = "status-proposal";
const LIST_LIMIT = 500;
const LEARNED_LIMIT = 20;
const CANDIDATE_LIMIT = 5;

// Without Sanity storage (tests and offline development) proposals stay in
// memory. A client injected for tests is used even then; pass null to reset.
const memory = new Map();
let clientInstance, injected = false;
const client = () => clientInstance ||= createStorageClient();
const useSanity = () => injected || sanityStorageEnabled();
export function setStatusProposalClient(next) { clientInstance = next || undefined; injected = !!next; }
export function resetStatusProposalsForTests() { memory.clear(); }

const badRequest = message => Object.assign(new Error(message), { status: 400 });
const notFound = message => Object.assign(new Error(message), { status: 404 });
const changed = () => Object.assign(new Error("This proposal changed while saving. Reload and try again."), { status: 409 });
const digest = value => createHash("sha256").update(value).digest("hex").slice(0, 24);

// One proposal per job and Gmail message, so a repeated routine run is a no-op.
export const statusProposalDocumentId = (jobId, messageId) => `status-proposal.${digest(`${jobId}\n${messageId}`)}`;

// "Jane Smith <jane@acme.com>" -> { name: "Jane Smith", address: "jane@acme.com" }.
export function parseSender(from) {
  const raw = String(from || "").trim();
  const angle = raw.match(/<([^<>\s]+@[^<>\s]+)>/);
  const address = (angle ? angle[1] : (raw.match(/[^\s<>"]+@[^\s<>"]+/) || [""])[0]).toLowerCase();
  const name = (angle ? raw.slice(0, angle.index) : raw.replace(address, "")).replace(/["']/g, "").trim();
  return { name, address: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address) ? address : "" };
}

// Mailbox providers, job boards and applicant tracking systems send for many
// companies, so their domains say nothing about which job an email is about.
const SHARED_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com",
  "me.com", "proton.me", "protonmail.com", "linkedin.com", "indeed.com", "glassdoor.com", "otta.com", "welcometothejungle.com",
  "greenhouse.io", "greenhouse-mail.io", "lever.co", "hire.lever.co", "ashbyhq.com", "workablemail.com", "workable.com",
  "smartrecruiters.com", "teamtailor.com", "teamtailor-mail.com", "personio.de", "personio.com", "bamboohr.com",
  "recruitee.com", "pinpointhq.com", "myworkday.com", "workday.com", "icims.com", "successfactors.com", "jobvite.com", "breezy.hr"]);
const sharedDomain = domain => [...SHARED_DOMAINS].some(shared => domain === shared || domain.endsWith(`.${shared}`));
const ROBOT_SENDER = /^(no-?reply|do-?not-?reply|notifications?|alerts?|jobs|careers|talent|recruiting|recruitment|hello|info|hr|team)([+._-].*)?$/;
// A sender worth remembering for a job: a person at a company, not a shared robot.
export const personalSender = address => !!address && !ROBOT_SENDER.test(address.split("@")[0]);

const normalise = value => String(value || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const compact = value => companyKey(value).replace(/ /g, "");

function domainMatches(address, company) {
  const domain = address.split("@")[1] || "";
  const key = compact(company);
  if (!domain || sharedDomain(domain) || key.length < 3) return false;
  return domain.split(".").slice(0, -1).some(label => label === key || (key.length >= 5 && label.startsWith(key)));
}

function subjectMentions(subject, company) {
  const key = companyKey(company);
  return key.length >= 3 && ` ${normalise(subject)} `.includes(` ${key} `);
}

const WEIGHTS = { thread: 1, recruiter: 0.9, domain: 0.7, company: 0.5 };
const ACTIVE_STAGES = ["reviewing", "applied", "interviewing", "offer"];

// Which jobs an email is likely about, best first. Signals: a Gmail thread
// seen on the job before (thread), a sender learned from an applied proposal
// or the job's recruiter by name (recruiter), the sender's company domain
// (domain), and the company named in the subject or passed explicitly (company).
export function matchEmailToJobs(jobs, { from = "", subject = "", threadId = "", company = "" } = {}) {
  const sender = parseSender(from);
  const senderName = normalise(sender.name);
  const companyHint = companyKey(company);
  const candidates = [];
  for (const job of jobs || []) {
    if (!job?.id) continue;
    const signals = [];
    if (threadId && ((job.emailThreadIds || []).includes(threadId) || job.threadId === threadId)) signals.push("thread");
    if ((sender.address && (job.emailSenders || []).includes(sender.address))
      || (senderName.includes(" ") && normalise(job.recruiter?.name) === senderName)) signals.push("recruiter");
    if (sender.address && domainMatches(sender.address, job.company)) signals.push("domain");
    const key = companyKey(job.company);
    if (subjectMentions(subject, job.company) || (companyHint && key && (companyHint === key || companyHint.includes(key) || key.includes(companyHint)))) signals.push("company");
    if (!signals.length) continue;
    const stage = normaliseJobStage(job.stage) || "new";
    // Several signals and a job already in progress make the match more likely.
    const score = Math.min(1, WEIGHTS[signals[0]] + 0.05 * (signals.length - 1) + (ACTIVE_STAGES.includes(stage) && !job.archived ? 0.05 : 0));
    candidates.push({ id: job.id, company: job.company || "", role: job.role || "", stage, archived: !!job.archived,
      matchedBy: signals[0], signals, score: Math.round(score * 100) / 100 });
  }
  return candidates.sort((a, b) => b.score - a.score || Number(a.archived) - Number(b.archived)).slice(0, CANDIDATE_LIMIT);
}

function text(value, max, label, { required = false } = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw badRequest(`${label} must be text.`);
  const clean = value.replace(/[\u0000-\u001f]+/g, " ").trim();
  if (required && !clean) throw badRequest(`${label} is required.`);
  if (clean.length > max) throw badRequest(`${label} must be ${max} characters or fewer.`);
  return clean;
}

// Validates the routine's POST body. Unknown fields are ignored.
export function validateProposalInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest("Send a JSON object.");
  const jobId = text(body.jobId, 200, "jobId", { required: true });
  const proposedStage = normaliseJobStage(body.proposedStage);
  if (!PROPOSABLE_STAGES.includes(proposedStage)) throw badRequest(`proposedStage must be one of ${PROPOSABLE_STAGES.join(", ")}.`);
  const summary = text(body.summary, PROPOSAL_SUMMARY_MAX_LENGTH, "summary", { required: true });
  if (typeof body.confidence !== "number" || !Number.isFinite(body.confidence) || body.confidence < 0 || body.confidence > 1) throw badRequest("confidence must be a number from 0 to 1.");
  if (!MATCHED_BY.includes(body.matchedBy)) throw badRequest(`matchedBy must be one of ${MATCHED_BY.join(", ")}.`);
  const email = body.email;
  if (!email || typeof email !== "object" || Array.isArray(email)) throw badRequest("email must be an object with the Gmail thread and message.");
  const date = text(email.date, 40, "email.date", { required: true });
  if (!Number.isFinite(Date.parse(date))) throw badRequest("email.date must be an ISO date and time.");
  const link = text(email.link, 500, "email.link");
  if (link && !/^https:\/\/mail\.google\.com\//.test(link)) throw badRequest("email.link must be a https://mail.google.com/ link.");
  const from = text(email.from, 320, "email.from", { required: true });
  const interview = body.interview === undefined || body.interview === null ? null : validateInterviewFields(body.interview);
  return {
    jobId, proposedStage, summary, confidence: Math.round(body.confidence * 1000) / 1000, matchedBy: body.matchedBy,
    email: { threadId: text(email.threadId, 200, "email.threadId", { required: true }), messageId: text(email.messageId, 200, "email.messageId", { required: true }),
      subject: text(email.subject, 300, "email.subject"), from, fromAddress: parseSender(from).address, date: new Date(date).toISOString(), link },
    interview,
  };
}

// The stored document. job is the pipeline job the proposal is about.
export function statusProposalRecord(input, job, { now = new Date() } = {}) {
  const sanityId = job?.[metadata]?._id;
  return {
    _id: statusProposalDocumentId(job.id, input.email.messageId), _type: STATUS_PROPOSAL_TYPE,
    jobId: job.id, ...(sanityId ? { job: { _type: "reference", _ref: sanityId, _weak: true } } : {}),
    company: job.company || "", role: job.role || "", currentStage: normaliseJobStage(job.stage) || "new",
    proposedStage: input.proposedStage, interview: input.interview, summary: input.summary,
    email: input.email, matchedBy: input.matchedBy, confidence: input.confidence,
    state: "open", createdAt: now.toISOString(), decidedAt: null, appliedFromStage: null,
  };
}

// The proposal as the admin and the routine see it.
export function proposalView(doc) {
  if (!doc || doc._type !== STATUS_PROPOSAL_TYPE) return null;
  const email = doc.email || {};
  return { id: doc._id, jobId: doc.jobId || "", company: doc.company || "", role: doc.role || "",
    currentStage: doc.currentStage || "", proposedStage: doc.proposedStage || "", interview: doc.interview || null,
    summary: doc.summary || "", matchedBy: doc.matchedBy || "", confidence: doc.confidence ?? null,
    email: { threadId: email.threadId || "", messageId: email.messageId || "", subject: email.subject || "",
      from: email.from || "", date: email.date || "", link: email.link || "" },
    state: doc.state || "open", createdAt: doc.createdAt || "", decidedAt: doc.decidedAt || "", appliedFromStage: doc.appliedFromStage || "" };
}

const PROPOSAL_FIELDS = "_id, _type, _rev, jobId, company, role, currentStage, proposedStage, interview, summary, email, matchedBy, confidence, state, createdAt, decidedAt, appliedFromStage";

async function readProposal(id) {
  if (!useSanity()) return memory.has(id) ? structuredClone(memory.get(id)) : null;
  return client().fetch(`*[_type == $type && _id == $id][0]{${PROPOSAL_FIELDS}}`, { type: STATUS_PROPOSAL_TYPE, id });
}

export async function getStatusProposal(id) {
  return typeof id === "string" && id.startsWith("status-proposal.") ? proposalView(await readProposal(id)) : null;
}

// Creates a proposal for the routine. settings is the published
// emailStatusProposals object (null while unpublished). Returns
// { created, reason?, proposal? }; reasons: duplicate, low-confidence, already-at-stage.
export async function createStatusProposal(body, { job, settings, now = new Date() }) {
  if (!settings?.enabled) throw Object.assign(new Error("Email status proposals are disabled. Publish emailStatusProposals with enabled: true in Sanity."), { status: 403 });
  const input = validateProposalInput(body);
  if (!job || job.id !== input.jobId) throw notFound("Job not found.");
  const existing = await readProposal(statusProposalDocumentId(job.id, input.email.messageId));
  if (existing) return { created: false, reason: "duplicate", proposal: proposalView(existing) };
  if (input.confidence < settings.minimumConfidence) return { created: false, reason: "low-confidence" };
  if (normaliseJobStage(job.stage) === input.proposedStage && !input.interview) return { created: false, reason: "already-at-stage" };
  const record = statusProposalRecord(input, job, { now });
  if (!useSanity()) {
    if (memory.has(record._id)) return { created: false, reason: "duplicate", proposal: proposalView(memory.get(record._id)) };
    memory.set(record._id, structuredClone(record));
    return { created: true, proposal: proposalView(record) };
  }
  // The ID is unique per job and message, so a concurrent repeat is a no-op.
  const saved = await client().createIfNotExists(record);
  const created = saved?.createdAt === record.createdAt;
  return { created, ...(created ? {} : { reason: "duplicate" }), proposal: proposalView(saved) };
}

// The Gmail message IDs, of those given, that already have a proposal in any
// state. Lets the Gmail check skip a message before reading it again.
export async function proposalMessageIds(messageIds) {
  const ids = [...new Set((messageIds || []).filter(id => typeof id === "string" && id))].slice(0, LIST_LIMIT);
  if (!ids.length) return new Set();
  if (!useSanity()) return new Set([...memory.values()].map(doc => doc.email?.messageId).filter(id => ids.includes(id)));
  const found = await client().fetch(`*[_type == $type && email.messageId in $ids].email.messageId`, { type: STATUS_PROPOSAL_TYPE, ids });
  return new Set(found || []);
}

// Newest first. state: open, applied, dismissed or all.
export async function listStatusProposals({ state = "open", jobId = "", limit = 100 } = {}) {
  if (state !== "all" && !PROPOSAL_STATES.includes(state)) throw badRequest(`state must be one of ${[...PROPOSAL_STATES, "all"].join(", ")}.`);
  const count = Math.max(1, Math.min(LIST_LIMIT, Math.floor(Number(limit)) || 100));
  const keep = doc => (state === "all" || doc.state === state) && (!jobId || doc.jobId === jobId);
  if (!useSanity()) return [...memory.values()].filter(keep)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, count).map(proposalView);
  const filters = ["_type == $type", ...(state === "all" ? [] : ["state == $state"]), ...(jobId ? ["jobId == $jobId"] : [])];
  const docs = await client().fetch(`*[${filters.join(" && ")}] | order(createdAt desc)[0...${count}]{${PROPOSAL_FIELDS}}`,
    { type: STATUS_PROPOSAL_TYPE, state, jobId });
  return docs.map(proposalView);
}

// Marks an open proposal applied or dismissed, guarded by its revision so two
// decisions cannot both land. Returns the updated proposal.
export async function decideStatusProposal(id, state, { appliedFromStage = null, now = new Date() } = {}) {
  if (!["applied", "dismissed"].includes(state)) throw badRequest("A proposal can only be applied or dismissed.");
  const doc = await readProposal(id);
  if (!doc) throw notFound("Proposal not found.");
  if (doc.state !== "open") throw Object.assign(new Error(`This proposal was already ${doc.state}.`), { status: 409 });
  const fields = { state, decidedAt: now.toISOString(), appliedFromStage: state === "applied" ? appliedFromStage : null };
  if (!useSanity()) {
    if (memory.get(id)?.state !== "open") throw changed();
    memory.set(id, { ...memory.get(id), ...fields });
    return proposalView(memory.get(id));
  }
  try { return proposalView(await client().patch(id).ifRevisionId(doc._rev).set(fields).commit()); }
  catch (error) { if (error?.statusCode === 409) throw changed(); throw error; }
}

const learned = (values, value) => !value || (values || []).includes(value) ? undefined
  : [...(values || []), value].slice(-LEARNED_LIMIT);

// The extra job fields Apply writes in the same guarded write as the stage:
// the email's thread and a personal sender, so later emails match this job,
// and the interview round when the proposal carries one. Synchronous and side
// effect free, as mutateJob callbacks must be; entry is built once beforehand.
export function proposalJobPatch(current, proposal, entry) {
  const patch = {};
  const threads = learned(current.emailThreadIds, proposal.email.threadId);
  if (threads) patch.emailThreadIds = threads;
  const address = parseSender(proposal.email.from).address;
  const senders = personalSender(address) ? learned(current.emailSenders, address) : undefined;
  if (senders) patch.emailSenders = senders;
  if (entry) Object.assign(patch, addTimelineEntry(current, entry) || {});
  return patch;
}

export const proposalTimelineEntry = (proposal, now = new Date()) => proposal.interview
  ? timelineEntry(proposal.interview, { source: "email", proposalId: proposal.id, id: `email-${proposal.id.split(".").pop()}`, now })
  : null;

// Applies an open proposal through changeJob, the jobs PATCH path, so audit,
// archiving, review decisions, Reviewing generation and CV submission behave
// exactly as for a manual move. Leaves the stage alone when the job is already
// there (an interview round while Interviewing). Marks the proposal applied
// only after the job write succeeds; a retry after a failed mark is safe
// because the timeline entry and learned ids are idempotent.
export async function applyStatusProposal(id, { getJob, changeJob, now = new Date() }) {
  const proposal = await getStatusProposal(id);
  if (!proposal) throw notFound("Proposal not found.");
  if (proposal.state !== "open") throw Object.assign(new Error(`This proposal was already ${proposal.state}.`), { status: 409 });
  const job = await getJob(proposal.jobId);
  if (!job) throw notFound("The proposal's job no longer exists.");
  const fromStage = normaliseJobStage(job.stage) || "new";
  const entry = proposalTimelineEntry(proposal, now);
  const body = fromStage === proposal.proposedStage ? {} : { stage: proposal.proposedStage };
  const result = await changeJob(proposal.jobId, body, { extraPatch: current => proposalJobPatch(current, proposal, entry) });
  if (result.status !== 200) return { status: result.status, json: result.json };
  const decided = await decideStatusProposal(id, "applied", { appliedFromStage: fromStage, now });
  return { status: 200, json: { proposal: decided, job: result.json.job, generationErrors: result.json.generationErrors || [] } };
}

// Needs you items for open proposals, newest first. Proposals whose job is gone are left out.
export function proposalNeedsYouItems(proposals, jobs) {
  const byId = new Map((jobs || []).map(job => [job.id, job]));
  return (proposals || []).filter(p => p?.state === "open" && byId.has(p.jobId))
    .map(p => { const job = byId.get(p.jobId);
      return { kind: NEEDS_YOU_PROPOSAL_KIND, id: p.id, jobId: p.jobId, company: job.company || p.company, role: job.role || p.role,
        stage: normaliseJobStage(job.stage) || "new", proposedStage: p.proposedStage, summary: p.summary, interview: p.interview,
        confidence: p.confidence, matchedBy: p.matchedBy,
        email: { subject: p.email.subject, from: p.email.from, date: p.email.date, link: p.email.link }, createdAt: p.createdAt }; })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Open proposals for Needs you. A failed read leaves them out rather than
// failing the jobs list.
export async function openProposalsForNeedsYou() {
  try { return await listStatusProposals({ state: "open", limit: LIST_LIMIT }); }
  catch (error) { console.warn("Could not read open email status proposals.", error?.message || ""); return []; }
}
