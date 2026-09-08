// Storage abstraction for saved fit reports.
//
// Default implementation uses Vercel KV (Upstash Redis under the hood).
// To use it: `npm i @vercel/kv` and add a KV store in the Vercel dashboard
// (it injects KV_REST_API_URL and KV_REST_API_TOKEN automatically).
//
// If those env vars aren't present, we fall back to an in-memory store so the
// app still runs locally (in-memory does NOT persist across serverless
// invocations in production — dev only).
//
// Swapping backends: implement saveReport / getReport / findReportByHash /
// checkAndCountRate against Netlify Blobs, your own DB, etc.

import { createHash, randomUUID } from "node:crypto";
import { hasKV, kv } from "./kv.js";
import { JOB_WRITE, REPORT_WRITE } from "./store-scripts.js";
import { DEFAULT_MODEL } from "./models.js";

function makeId() {
  return randomUUID().replace(/-/g, "");
}

// Normalise a JD so trivially-different pastes (spacing, case) dedupe together.
export function hashJD(jd) {
  const normalised = String(jd || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalised).digest("hex").slice(0, 24);
}

// Has a row's job description moved on from the one its analysis was built on?
//
// Compare normalized content rather than length. Even an equal-length edit can
// change a requirement, while whitespace and case-only changes remain fresh.
export function jdChange(rowJd, analysedJd) {
  const now = String(rowJd || "");
  const was = String(analysedJd || "");
  return { was: was.length, now: now.length, stale: hashJD(now) !== hashJD(was) };
}

const INDEX_KEY = "fit:index"; // sorted set of report ids, scored by creation time

// --- In-memory fallback (dev only) ---
const memory = new Map(); // key -> { value, expiresAt }
const memIndex = []; // [{ id, score }], newest last
const memJobIndex = []; // same shape, for opportunities

function memGet(key) {
  const e = memory.get(key);
  if (!e) return null;
  if (e.expiresAt && e.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return structuredClone(e.value);
}
function memSet(key, value, exSeconds) {
  memory.set(key, {
    value: structuredClone(value),
    expiresAt: exSeconds ? Date.now() + exSeconds * 1000 : 0,
  });
}
function memIncr(key, exSeconds) {
  const cur = memGet(key) || 0;
  const next = cur + 1;
  memSet(key, next, exSeconds);
  return next;
}


// --- Reports ---

const MAX_VERSIONS = 10;
const conflict = () => Object.assign(new Error("This record changed while saving. Please retry."), { status: 409 });
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const versionKey = id => "fitver:" + id;
const sourceKey = id => "fitsource:" + id;
const legacyCacheKey = report => "jdhash:" + hashJD(report?.job_description || "");
const cacheKey = report => legacyCacheKey(report) + ":" + digest([report?.model || DEFAULT_MODEL, report?.generation || null]);

function sourceOf(report) {
  return {
    hash: hashJD(report.job_description || ""),
    length: (report.job_description || "").length,
    model: report.model || DEFAULT_MODEL,
    generation: report.generation || null,
  };
}

// Read revision first. A write during the following reads invalidates the CAS,
// so a snapshot cannot pair old content with a newer revision.
async function changeReport(id, mutate, { create = false } = {}) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const client = hasKV ? await kv() : null;
    const revision = Number(client ? await client.get("fitrev:" + id) : memGet("fitrev:" + id)) || 0;
    const [report, versions] = await Promise.all([getReport(id), listReportVersions(id)]);
    if (!report && !create) return null;
    const next = mutate(report, versions);
    if (next === undefined) return null;
    const nextReport = next.report;
    const nextVersions = (next.versions || []).slice(0, MAX_VERSIONS);
    const score = new Date(nextReport?.created_at || report?.created_at || "").getTime() || Date.now();
    const keys = ["fit:" + id, versionKey(id), "fitrev:" + id, sourceKey(id), INDEX_KEY,
      cacheKey(report), legacyCacheKey(report), cacheKey(nextReport), legacyCacheKey(nextReport)];
    let saved;
    if (client) {
      saved = await client.eval(REPORT_WRITE, keys, [
        revision, nextReport ? JSON.stringify(nextReport) : "",
        JSON.stringify(nextVersions), score, id,
        nextReport ? JSON.stringify(sourceOf(nextReport)) : "",
      ]);
    } else {
      saved = (Number(memGet(keys[2])) || 0) === revision;
      if (saved) {
        for (const key of keys.slice(5, 7)) if (memGet(key) === id) memory.delete(key);
        if (nextReport) {
          memSet(keys[0], nextReport, 0);
          memSet(keys[1], nextVersions, 0);
          memSet(keys[3], sourceOf(nextReport), 0);
          memSet(keys[7], id, 0);
          memSet(keys[8], id, 0);
          const entry = memIndex.find(e => e.id === id);
          if (entry) entry.score = score;
          else memIndex.push({ id, score });
        } else {
          for (const key of [keys[0], keys[1], keys[3]]) memory.delete(key);
          const index = memIndex.findIndex(e => e.id === id);
          if (index !== -1) memIndex.splice(index, 1);
        }
        memSet(keys[2], revision + 1, 0);
      }
    }
    if (saved) return next.result;
  }
  throw conflict();
}

export async function saveReport(report, internal) {
  const id = makeId();
  await addReportVersion(id, report, internal, { create: true });
  return id;
}

export async function getReport(id) {
  return hasKV ? (await (await kv()).get("fit:" + id)) || null : memGet("fit:" + id) || null;
}

export async function getReportRevision(id) {
  return Number(hasKV ? await (await kv()).get("fitrev:" + id) : memGet("fitrev:" + id)) || 0;
}

export async function listReportVersions(id) {
  const raw = hasKV ? await (await kv()).get(versionKey(id)) : memGet(versionKey(id));
  return Array.isArray(raw) ? raw : [];
}

// Used for legacy imports and tests. Normal generation uses addReportVersion,
// which publishes the live content and its version in the same atomic write.
export async function overwriteReport(id, report) {
  return changeReport(id, (_, versions) => ({ report, versions, result: report }));
}

export async function addReportVersion(id, report, internal, options = {}) {
  const vid = options.vid || makeId();
  return changeReport(id, (_, versions) => {
    const entry = {
      vid, createdAt: report.regenerated_at || report.created_at || new Date().toISOString(),
      model: report.model || "", internal: internal || null, report,
    };
    return {
      report,
      versions: [entry, ...versions.filter(v => v.vid !== vid)].map((v, i) => ({ ...v, active: i === 0 })),
      result: vid,
    };
  }, options);
}

export async function activateReportVersion(id, vid) {
  return changeReport(id, (_, versions) => {
    const wanted = versions.find(v => v.vid === vid);
    if (!wanted) return undefined;
    return { report: wanted.report, versions: versions.map(v => ({ ...v, active: v.vid === vid })), result: wanted.report };
  });
}

export async function listReportIds({ offset = 0, limit = 100 } = {}) {
  if (hasKV) return (await kv()).zrange(INDEX_KEY, offset, offset + limit - 1, { rev: true });
  return memIndex.slice().sort((a, b) => b.score - a.score).slice(offset, offset + limit).map(e => e.id);
}

export async function listReports({ offset = 0, limit = 20 } = {}) {
  const [ids, total] = await Promise.all([
    listReportIds({ offset, limit }),
    hasKV ? (await kv()).zcard(INDEX_KEY) : memIndex.length,
  ]);
  const values = ids.length
    ? hasKV ? await (await kv()).mget(...ids.map(id => "fit:" + id)) : ids.map(id => memGet("fit:" + id))
    : [];
  return { reports: ids.map((id, i) => values[i] ? { id, ...values[i] } : null).filter(r => r?.created_at), total };
}

export async function deleteReport(id) {
  return (await changeReport(id, () => ({ report: null, versions: [], result: true }))) || false;
}

// Legacy reports are read once to fill missing metadata. SET NX avoids
// replacing metadata written by a concurrent generation.
export async function getReportSources(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const client = hasKV ? await kv() : null;
  const values = client ? await client.mget(...unique.map(sourceKey)) : unique.map(id => memGet(sourceKey(id)));
  const out = {};
  await Promise.all(unique.map(async (id, i) => {
    if (values[i]) { out[id] = values[i]; return; }
    const report = await getReport(id);
    if (!report) return;
    const source = sourceOf(report);
    if (client) {
      await client.set(sourceKey(id), source, { nx: true });
      out[id] = await client.get(sourceKey(id));
    } else {
      if (!memGet(sourceKey(id))) memSet(sourceKey(id), source, 0);
      out[id] = memGet(sourceKey(id));
    }
  }));
  return out;
}

// --- Opportunities (the job pipeline) ---
//
// Stored one key per opportunity, with a sorted set indexing them by the date
// the opportunity arrived so the board lists newest first.

const JOBS_INDEX = "jobs:index";

// One question from an application form. The id is stable so the page can ask
// for a specific one to be answered without sending the whole array back.
function normaliseQuestion(q) {
  const limit = Math.round(Number(q && q.limit));
  return {
    id: (q && q.id) || Math.random().toString(36).slice(2, 10),
    q: String((q && q.q) || "").slice(0, 2000),
    a: String((q && q.a) || "").slice(0, 8000),
    limit: Number.isFinite(limit) ? Math.min(500, Math.max(20, limit)) : 120,
    refused: !!(q && q.refused),
    reason: String((q && q.reason) || "").slice(0, 500),
    answeredAt: (q && q.answeredAt) || "",
  };
}

export const JOB_STAGES = [
  "new",
  "reviewing",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "not_a_fit",
  // Terminal, and not a judgement either way: the role went away before the
  // process did. Kept apart from rejected and not_a_fit so the pipeline counts
  // stay honest about what actually happened.
  "expired",
];

// Every row, archived included. Internal: lookups that need to see archived
// rows (import matching, report linking) use this so an archived row is found
// and updated rather than silently duplicated.
async function listAllJobs() {
  if (hasKV) {
    const store = await kv();
    const ids = await store.zrange(JOBS_INDEX, 0, -1, { rev: true });
    if (!ids.length) return [];
    const jobs = await store.mget(...ids.map((id) => `job:${id}`));
    return ids.map((id, i) => (jobs[i] ? { ...jobs[i], id } : null)).filter(Boolean);
  }
  return memJobIndex
    .slice()
    .sort((a, b) => b.score - a.score)
    .map(({ id }) => {
      const j = memGet(`job:${id}`);
      return j ? { ...j, id } : null;
    })
    .filter(Boolean);
}

// The pipeline. Archived rows are hidden by default; nothing is ever deleted,
// so the fit page for an archived row keeps resolving for anyone holding the link.
export async function listJobs({ includeArchived = false, onlyArchived = false } = {}) {
  const all = await listAllJobs();
  if (onlyArchived) return all.filter((j) => j.archived);
  if (includeArchived) return all;
  return all.filter((j) => !j.archived);
}

export async function countArchivedJobs() {
  return (await listAllJobs()).filter((j) => j.archived).length;
}

export async function getJob(id) {
  if (hasKV) {
    const store = await kv();
    const j = await store.get(`job:${id}`);
    return j ? { ...j, id } : null;
  }
  const j = memGet(`job:${id}`);
  return j ? { ...j, id } : null;
}

function jobRecord(job, revision) {
  const now = new Date().toISOString();
  return {
    revision,
    externalId: job.externalId || "",
    company: job.company || "",
    role: job.role || "",
    source: job.source || "",
    sourceType: job.sourceType || "other",
    sourceUrl: job.sourceUrl || "",
    threadId: job.threadId || "",
    location: job.location || "",
    locationMode: job.locationMode || "",
    salary: job.salary || "",
    // Fit read from the inbox scan. Null for anything added by hand.
    score: typeof job.score === "number" ? job.score : null,
    tier: job.tier || "",
    scoreBreakdown: job.scoreBreakdown || null,
    rationale: job.rationale || "",
    replyOwed: !!job.replyOwed,
    userViewed: !!job.userViewed,
    closed: !!job.closed,
    coverLetter: Array.isArray(job.coverLetter) ? job.coverLetter : null,
    coverLetterId: job.coverLetterId || "",
    coverLetterAt: job.coverLetterAt || "",
    coverLetterModel: job.coverLetterModel || "",
    coverLetterSalutation: job.coverLetterSalutation || "",
    coverLetterWords: Number(job.coverLetterWords) || 0,
    coverLetterVersionCount: Number(job.coverLetterVersionCount) ||
      (Array.isArray(job.coverLetterVersions) ? job.coverLetterVersions.length : 0),
    coverRun: job.coverRun && typeof job.coverRun === "object" ? {
      requestId: job.coverRun.requestId || "",
      runId: job.coverRun.runId || "",
      fingerprint: job.coverRun.fingerprint || "",
      status: job.coverRun.status || "",
      startedAt: job.coverRun.startedAt || "",
      finishedAt: job.coverRun.finishedAt || "",
    } : null,
    // Legacy embedded letters remain readable until the artifact layer migrates
    // them. New drafts keep these fields empty and store only the pointer above.
    coverLetterVersions: Array.isArray(job.coverLetterVersions)
      ? job.coverLetterVersions.slice(0, 10)
      : [],
    archived: !!job.archived,
    archivedAt: job.archived ? job.archivedAt || now : "",
    recruiter: job.recruiter || null,
    stage: JOB_STAGES.includes(job.stage) ? job.stage : "new",
    fitReportId: job.fitReportId || "",
    jobDescription: job.jobDescription || "",
    notes: job.notes || "",
    // Free-text steer for the analysis and the letter. Written by me, so
    // unlike a job description this is trusted and followed as instruction.
    instructions: job.instructions || "",
    // Extra questions an application form asks, with the drafted answers kept
    // alongside so the set stays consistent and can be reread later. Admin
    // only: these never travel with the fit report.
    questions: Array.isArray(job.questions) ? job.questions.map(normaliseQuestion) : [],
    receivedAt: job.receivedAt || now,
    createdAt: job.createdAt || now,
    updatedAt: now,
  };
}

export async function saveJob(job) {
  const id = job.id || makeId();
  return mutateJob(id, () => job, { create: true });
}

// Callbacks are synchronous, side-effect free patches, reapplied to the latest
// record after a conflict. Never calculate array replacements before calling.
export async function mutateJob(id, mutate, { create = false, expectedRevision, expectedReportRevision } = {}) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const current = await getJob(id);
    if (!current && !create) return null;
    const revision = current ? Number(current.revision) || 0 : -1;
    if (expectedRevision !== undefined && expectedRevision !== revision) throw conflict();
    const patch = mutate(current || {});
    if (patch === undefined) return current;
    const record = patch === null ? null : jobRecord({ ...current, ...patch }, revision + 1);
    const score = new Date(record?.receivedAt || "").getTime() || Date.now();
    let saved;
    if (hasKV) {
      const reportRevisionKey = expectedReportRevision ? `fitrev:${expectedReportRevision.id}` : "fitrev:_none";
      saved = await (await kv()).eval(JOB_WRITE, [`job:${id}`, JOBS_INDEX, DISMISSED, reportRevisionKey],
        [revision, record ? JSON.stringify(record) : "", score, id,
          expectedReportRevision ? expectedReportRevision.revision : ""]);
      if (Number(saved) === -1) {
        throw Object.assign(new Error("The linked analysis changed while saving."), { status: 409, code: "REPORT_CHANGED" });
      }
    } else {
      const latest = memGet(`job:${id}`);
      if (expectedReportRevision &&
          (Number(memGet(`fitrev:${expectedReportRevision.id}`)) || 0) !== expectedReportRevision.revision) {
        throw Object.assign(new Error("The linked analysis changed while saving."), { status: 409, code: "REPORT_CHANGED" });
      }
      saved = (latest ? Number(latest.revision) || 0 : -1) === revision;
      if (saved) {
        if (record) {
          memSet(`job:${id}`, record, 0);
          const entry = memJobIndex.find(e => e.id === id);
          if (entry) entry.score = score;
          else memJobIndex.push({ id, score });
        } else {
          const dismissed = memGet(DISMISSED) || [];
          if (current.fitReportId && !dismissed.includes(current.fitReportId)) memSet(DISMISSED, [...dismissed, current.fitReportId], 0);
          memory.delete(`job:${id}`);
          const i = memJobIndex.findIndex(e => e.id === id);
          if (i !== -1) memJobIndex.splice(i, 1);
        }
      }
    }
    if (saved) return record ? { ...record, id } : current;
  }
  throw conflict();
}

export async function updateJob(id, patch, options) {
  return mutateJob(id, () => patch, options);
}

export async function editQuestion(id, edit) {
  if (!edit || typeof edit.id !== "string" || !edit.id) throw Object.assign(new Error("Missing question id"), { status: 400 });
  return mutateJob(id, job => {
    const questions = job.questions || [];
    const existing = questions.find(q => q.id === edit.id);
    if (edit.remove) return { questions: questions.filter(q => q.id !== edit.id) };
    const next = normaliseQuestion({ ...existing, id: edit.id,
      ...(edit.q !== undefined ? { q: edit.q } : {}), ...(edit.limit !== undefined ? { limit: edit.limit } : {}),
      ...(existing && edit.q !== undefined && edit.q !== existing.q
        ? { a: "", reason: "", refused: false, answeredAt: "" } : {}),
    });
    return { questions: existing ? questions.map(q => q.id === next.id ? next : q) : [...questions, next] };
  });
}

// Reports whose row was deleted on purpose. The analysis itself is kept, so
// any link already shared keeps resolving, but the pipeline must not offer to
// re-adopt it: without this, deleting a duplicate row orphans its report and
// the next adopt builds the row again, unarchived and back at stage new. Four
// rows deleted one morning were back the same evening that way.
const DISMISSED = "jobs:dismissed-reports";

async function dismissedReports() {
  if (hasKV) {
    const store = await kv();
    return new Set((await store.smembers(DISMISSED)) || []);
  }
  return new Set(memGet(DISMISSED) || []);
}

// Exported so a row deleted by mistake can be brought back: undismissing the
// report makes adopt offer it again.
export async function undismissReport(reportId) {
  if (!reportId) return false;
  if (hasKV) {
    const store = await kv();
    await store.srem(DISMISSED, reportId);
  } else {
    memSet(DISMISSED, (memGet(DISMISSED) || []).filter((r) => r !== reportId), 0);
  }
  return true;
}

export async function deleteJob(id, { requireArchived = false } = {}) {
  return !!(await mutateJob(id, current => {
    if (requireArchived && !current.archived) throw Object.assign(new Error("Archive this row before deleting it."), { status: 409 });
    return null;
  }));
}

// Used by the inbox import so re-running it doesn't create duplicates.
//
// The scan hands us an externalId it composed itself, which is exactly the
// thing that drifts: the same LinkedIn posting arrived as
// `formula--engineering-manager-ai-agentic` one day and
// `formula--engineering-manager-ai-agentic-systems` the next, because the role
// title was read off the fetched page one time and off the digest listing the
// other. An exact externalId match saw two different jobs and opened a second
// row on top of one already applied to. So the id the caller invents is the
// first thing we try, not the only one.
//
// After it: the posting id out of the LinkedIn URL, which is the identity the
// job board itself assigns and so cannot drift; then company and role with
// punctuation flattened, which folds "AI & Agentic Systems" onto
// "AI/Agentic Systems". Both are exact matches on a normalised value rather
// than fuzzy ones, so nothing here merges two roles that genuinely read
// differently.
const normalise = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Board URLs carry per-email tracking junk, so compare the posting id in them
// rather than the URL itself.
export function postingId(url) {
  const m = /\/jobs\/view\/(\d+)/.exec(String(url || ""));
  return m ? m[1] : "";
}

export async function findExistingJob({ externalId, threadId, sourceUrl, company, role }) {
  // Archived rows count as existing, otherwise a re-import would resurrect
  // something deliberately filed away as if it were fresh.
  const jobs = await listAllJobs();

  if (externalId) {
    const hit = jobs.find((j) => j.externalId === externalId);
    if (hit) return hit;
  }

  const pid = postingId(sourceUrl);
  if (pid) {
    const hit = jobs.find((j) => postingId(j.sourceUrl) === pid);
    if (hit) return hit;
  }

  const c = normalise(company), r = normalise(role);
  if (c && r) {
    const hit = jobs.find((j) => normalise(j.company) === c && normalise(j.role) === r);
    if (hit) return hit;
  }

  // Last, and only when the caller had no id of its own. One thread can hold
  // several distinct roles, so matching on a thread once an externalId exists
  // would collapse every other role in that digest onto the first one's row.
  if (!externalId && threadId) return jobs.find((j) => j.threadId === threadId) || null;
  return null;
}

// Given a freshly saved analysis, find the pipeline row it belongs to. Either
// the report is already linked, or the job holds the same job description and
// just hasn't been analysed yet.
export async function findJobForReport(reportId, jd) {
  // Archived included: re-analysing an archived role should reattach to it,
  // not spawn a new pipeline row.
  const jobs = await listAllJobs();
  const byReport = jobs.find((j) => j.fitReportId && j.fitReportId === reportId);
  if (byReport) return byReport;
  if (!jd) return null;
  const target = hashJD(jd);
  return jobs.find((j) => j.jobDescription && hashJD(j.jobDescription) === target) || null;
}

// Report ids that no pipeline row points at, so the admin page can offer to
// pull older analyses into the pipeline.
export async function findUnlinkedReportIds(jobs) {
  jobs = jobs || await listAllJobs();
  const linked = new Set(jobs.map((j) => j.fitReportId).filter(Boolean));
  const dismissed = await dismissedReports();
  const unlinked = [];
  for (let offset = 0; ; offset += 100) {
    const ids = await listReportIds({ offset, limit: 100 });
    unlinked.push(...ids.filter(id => !linked.has(id) && !dismissed.has(id)));
    if (ids.length < 100) break;
  }
  return unlinked;
}

// --- Analytics ---
//
// Counters per report id, plus a first/last seen timestamp. Deliberately
// aggregate only: no IPs, user agents, or anything identifying a viewer.

const TRACKED_EVENTS = ["view", "copy_link", "cv_download"];

export async function trackEvent(reportId, event) {
  if (!reportId || !TRACKED_EVENTS.includes(event)) return false;
  const now = new Date().toISOString();
  if (hasKV) {
    const store = await kv();
    await store.pipeline().hincrby(`stats:${reportId}`, event, 1)
      .hset(`stats:${reportId}`, { lastAt: now }).hsetnx(`stats:${reportId}`, "firstAt", now).exec();
  } else {
    const s = memGet(`stats:${reportId}`) || {};
    s[event] = (s[event] || 0) + 1;
    s.lastAt = now;
    if (!s.firstAt) s.firstAt = now;
    memSet(`stats:${reportId}`, s, 0);
  }
  return true;
}

export async function getStats(reportIds) {
  const ids = [...new Set(Array.isArray(reportIds) ? reportIds : [reportIds])].filter(Boolean);
  const out = {};
  if (hasKV) {
    const store = await kv();
    if (!ids.length) return out;
    const pipeline = store.pipeline();
    ids.forEach(id => pipeline.hgetall(`stats:${id}`));
    const values = await pipeline.exec();
    ids.forEach((id, i) => { out[id] = normaliseStats(values[i] || {}); });
    return out;
  }
  ids.forEach((id) => {
    out[id] = normaliseStats(memGet(`stats:${id}`) || {});
  });
  return out;
}

function normaliseStats(s) {
  return {
    view: Number(s.view || 0),
    copy_link: Number(s.copy_link || 0),
    cv_download: Number(s.cv_download || 0),
    firstAt: s.firstAt || null,
    lastAt: s.lastAt || null,
  };
}

// Returns { id, report } if this exact JD was already analysed, else null.
export async function findReportByHash(jd, options) {
  if (!String(jd || "").trim()) return null;
  const wanted = { job_description: jd, model: options?.model, generation: options?.generation };
  const key = options ? cacheKey(wanted) : legacyCacheKey(wanted);
  const id = hasKV ? await (await kv()).get(key) : memGet(key);
  if (!id) return null;
  const report = await getReport(id);
  if (!report || hashJD(report.job_description) !== hashJD(jd)) return null;
  if (options && cacheKey(report) !== key) return null;
  return { id, report };
}

// --- Rate limiting (fixed window per IP) ---
// Returns { allowed, remaining, limit, resetInSeconds }.
export async function checkAndCountRate(ip, limit = 10, windowSeconds = 3600) {
  const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `rl:${ip}:${bucket}`;
  let count;
  if (hasKV) {
    const store = await kv();
    count = await store.incr(key);
    if (count === 1) await store.expire(key, windowSeconds);
  } else {
    count = memIncr(key, windowSeconds);
  }
  const resetInSeconds =
    windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    limit,
    resetInSeconds,
  };
}
