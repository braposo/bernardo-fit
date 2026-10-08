// Jobs the automatic screens analysed but kept out of the pipeline. Stored in
// Sanity as `filteredJob` documents so they can be reviewed and moved into the
// pipeline by hand. One document per posting: a later screen of the same
// posting refreshes it rather than adding a duplicate.
import { createHash } from "node:crypto";
import { createStorageClient, sanityStorageEnabled } from "./sanity/client.js";
import { analysisSettings } from "./sanity/analysis-settings.js";
import { createJobIfAbsent, findExistingJob, getJob } from "./store.js";
import { cleanOpportunity, ingestIdentity } from "./ingest-work.js";

export const FILTERED_JOB_TYPE = "filteredJob";
export const FILTERED_DECISIONS = ["title-mismatch", "below-threshold", "constraint-conflict", "needs-review"];
const LIST_LIMIT = 1000;

const notFound = () => Object.assign(new Error("This filtered job no longer exists."), { status: 404 });
const conflict = () => Object.assign(new Error("This filtered job changed while moving it. Reload and try again."), { status: 409 });
const percent = value => `${Math.round(value * 100)}%`;
const key = value => createHash("sha256").update(String(value)).digest("hex").slice(0, 12);

// Without Sanity storage (tests and offline development) records stay in memory.
const memory = new Map();
let clientInstance;
const client = () => clientInstance ||= createStorageClient();
export function setFilteredJobClient(next) { clientInstance = next; }

export const filteredJobDocumentId = identity => `filtered-job.${identity}`;

function dimensionsOf(assessment) {
  return (assessment?.dimensions || []).filter(d => Number.isFinite(d.score))
    .map(d => ({ _key: key(d.id || d.label), id: String(d.id || ""), label: String(d.label || d.id || ""),
      score: d.score, weight: Number.isFinite(d.weight) ? d.weight : null }));
}

// A short, factual reason built only from the saved screening result.
export function filteredReason({ decision, score, minimumScore, relevanceProbability, assessment }) {
  if (decision === "title-mismatch")
    return `The title screen judged this unlikely to be an Engineering Manager match (${percent(relevanceProbability ?? 0)} relevant), so the full description was not fetched.`;
  if (decision === "constraint-conflict") {
    const certainty = assessment?.constraint?.probabilities?.conflict;
    return `Conflicts with a hard constraint${Number.isFinite(certainty) ? ` (${percent(certainty)} certain)` : ""}.` +
      (Number.isFinite(score) ? ` Fit score ${score}.` : "");
  }
  if (decision === "needs-review") {
    const choice = assessment?.posting?.choice;
    return choice === "inaccessible" ? "The posting could not be read: it looked like a login wall, an expired posting or an error page."
      : choice === "unrelated" ? "The fetched page did not look like a job posting."
      : "The assessment could not produce a usable score.";
  }
  const weakest = dimensionsOf(assessment).sort((a, b) => a.score - b.score).slice(0, 2).map(d => d.label);
  return `Scored ${score}, below the admission threshold of ${minimumScore}.` +
    (weakest.length ? ` Weakest: ${weakest.join(" and ")}.` : "");
}

// Builds the stored record. `opportunity` keeps the fields needed to recreate
// the job; `assessment` is kept verbatim so a moved job keeps its scores.
export function filteredJobRecord({ opportunity, decision, assessment = null, minimumScore = null,
  relevanceProbability = null, source = "", now = new Date() }) {
  if (!FILTERED_DECISIONS.includes(decision)) throw new TypeError(`Unknown filter decision ${decision}`);
  const opp = cleanOpportunity(opportunity);
  const identity = ingestIdentity(opp);
  const score = Number.isFinite(assessment?.score) ? assessment.score : null;
  return {
    _id: filteredJobDocumentId(identity), _type: FILTERED_JOB_TYPE, identity,
    company: opp.company || "", role: opp.role || "", location: opp.location || "",
    sourceUrl: opp.sourceUrl || "", externalId: opp.externalId || "", source: source || opp.source || "",
    postedDate: opportunity?.postedDate || "",
    stage: decision === "title-mismatch" ? "title" : "assessment",
    decision, score, minimumScore: Number.isInteger(minimumScore) ? minimumScore : null,
    relevanceProbability: Number.isFinite(relevanceProbability) ? relevanceProbability : null,
    reason: filteredReason({ decision, score, minimumScore, relevanceProbability, assessment }),
    dimensions: dimensionsOf(assessment),
    hasDescription: !!opp.jobDescription,
    opportunity: JSON.stringify(opp),
    assessment: assessment ? JSON.stringify(assessment) : "",
    filteredAt: now.toISOString(),
  };
}

// Create or refresh. Preserves the first-seen date and never revives a record
// already moved into the pipeline.
export async function recordFilteredJob(entry) {
  const record = filteredJobRecord(entry);
  const { _id, _type, ...fields } = record;
  if (!sanityStorageEnabled()) {
    const current = memory.get(_id);
    if (current?.movedAt) return current;
    const next = { ...current, ...record, firstFilteredAt: current?.firstFilteredAt || record.filteredAt };
    memory.set(_id, next);
    return next;
  }
  const sanity = client();
  await sanity.createIfNotExists({ _id, _type, identity: record.identity, firstFilteredAt: record.filteredAt });
  const current = await sanity.getDocument(_id);
  if (!current || current.movedAt) return current;
  // Guard on the revision just read so a concurrent move is never overwritten.
  return sanity.patch(_id).ifRevisionId(current._rev).set(fields).commit({ visibility: "async" });
}

// Recording is best effort for the screens: a storage failure must not turn a
// finished screen into a failed run, but it is reported back to the caller.
export async function recordFilteredJobs(entries) {
  let recorded = 0;
  const failures = [];
  for (const entry of entries) {
    try { await recordFilteredJob(entry); recorded++; }
    catch (error) { failures.push({ company: entry.opportunity?.company || "", role: entry.opportunity?.role || "", reason: error.message }); }
  }
  if (failures.length) console.warn(`Could not record ${failures.length} filtered job(s).`);
  return { recorded, failures };
}

const LIST_FIELDS = "_id, _rev, identity, company, role, location, sourceUrl, source, postedDate, stage, decision, score, minimumScore, relevanceProbability, reason, dimensions[]{id, label, score, weight}, filteredAt, firstFilteredAt, hasDescription";

function summary(doc) {
  return { id: doc.identity, company: doc.company || "", role: doc.role || "", location: doc.location || "",
    sourceUrl: doc.sourceUrl || "", source: doc.source || "", postedDate: doc.postedDate || "",
    stage: doc.stage, decision: doc.decision, score: doc.score ?? null, minimumScore: doc.minimumScore ?? null,
    relevanceProbability: doc.relevanceProbability ?? null, reason: doc.reason || "",
    dimensions: (doc.dimensions || []).map(({ id, label, score, weight }) => ({ id, label, score, weight: weight ?? null })),
    filteredAt: doc.filteredAt || "", firstFilteredAt: doc.firstFilteredAt || doc.filteredAt || "", hasDescription: !!doc.hasDescription };
}

// Newest first; moved records are hidden because they now live in the pipeline.
export async function listFilteredJobs() {
  if (!sanityStorageEnabled()) return [...memory.values()].filter(doc => !doc.movedAt)
    .sort((a, b) => String(b.filteredAt).localeCompare(String(a.filteredAt))).map(summary);
  const docs = await client().fetch(`*[_type == $type && !defined(movedAt)] | order(filteredAt desc)[0...${LIST_LIMIT}]{${LIST_FIELDS}}`,
    { type: FILTERED_JOB_TYPE });
  return docs.map(summary);
}

async function readRecord(identity) {
  if (!/^ing_[a-f0-9]{20}$/.test(String(identity || ""))) throw notFound();
  const id = filteredJobDocumentId(identity);
  const doc = sanityStorageEnabled() ? await client().getDocument(id) : memory.get(id);
  if (!doc) throw notFound();
  return doc;
}

// Puts a filtered job into the pipeline at New, with its saved description and
// assessment when the screen got that far. No AI work runs here.
export async function moveFilteredJob(identity, { now = new Date() } = {}) {
  const doc = await readRecord(identity);
  let opportunity, assessment = null;
  try {
    opportunity = JSON.parse(doc.opportunity || "{}");
    assessment = doc.assessment ? JSON.parse(doc.assessment) : null;
  } catch { throw Object.assign(new Error("This filtered job's saved details are unreadable."), { status: 422 }); }
  let job = doc.movedJobId ? await getJob(doc.movedJobId) : null;
  if (!job) job = await findExistingJob(opportunity);
  if (!job) {
    job = await createJobIfAbsent(doc.identity, { ...cleanOpportunity(opportunity), stage: "new",
      ...(assessment && Number.isFinite(assessment.score) ? { jevAssessment: assessment } : {}) });
  }
  if (!job) throw conflict();
  const movedAt = now.toISOString();
  if (sanityStorageEnabled()) {
    try { await client().patch(doc._id).ifRevisionId(doc._rev).set({ movedAt, movedJobId: job.id }).commit({ visibility: "sync" }); }
    catch (error) { if (error.statusCode === 409) throw conflict(); throw error; }
  } else memory.set(doc._id, { ...doc, movedAt, movedJobId: job.id });
  return job;
}

// Retention is published in Analysis settings. Without a published value
// nothing is removed.
export function filteredJobRetentionDays() {
  const days = analysisSettings().filteredJobRetentionDays;
  return Number.isInteger(days) ? days : null;
}

export async function purgeFilteredJobs({ now = new Date(), days = filteredJobRetentionDays() } = {}) {
  if (!Number.isInteger(days)) return { removed: 0, skipped: "no published retention" };
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
  if (!sanityStorageEnabled()) {
    let removed = 0;
    for (const [id, doc] of memory) if (String(doc.filteredAt) < cutoff) { memory.delete(id); removed++; }
    return { removed };
  }
  const ids = await client().fetch(`*[_type == $type && filteredAt < $cutoff][0...500]._id`,
    { type: FILTERED_JOB_TYPE, cutoff });
  if (!ids.length) return { removed: 0 };
  let tx = client().transaction();
  for (const id of ids) tx = tx.delete(id);
  await tx.commit({ visibility: "async" });
  return { removed: ids.length };
}

export function resetFilteredJobsForTests() { memory.clear(); }
