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

import { createHash } from "node:crypto";

function makeId() {
  return (
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 6)
  );
}

// Normalise a JD so trivially-different pastes (spacing, case) dedupe together.
export function hashJD(jd) {
  const normalised = String(jd || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalised).digest("hex").slice(0, 24);
}

const hasKV =
  !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

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
  return e.value;
}
function memSet(key, value, exSeconds) {
  memory.set(key, {
    value,
    expiresAt: exSeconds ? Date.now() + exSeconds * 1000 : 0,
  });
}
function memIncr(key, exSeconds) {
  const cur = memGet(key) || 0;
  const next = cur + 1;
  memSet(key, next, exSeconds);
  return next;
}

async function kv() {
  const mod = await import("@vercel/kv");
  return mod.kv;
}

const REPORT_TTL = 60 * 60 * 24 * 365; // 1 year; set to 0 to keep forever

// --- Reports ---

export async function saveReport(report) {
  const id = makeId();
  const hash = hashJD(report.job_description || "");
  const score = Date.now();
  if (hasKV) {
    const store = await kv();
    const opts = REPORT_TTL ? { ex: REPORT_TTL } : undefined;
    await store.set(`fit:${id}`, report, opts);
    if (hash) await store.set(`jdhash:${hash}`, id, opts);
    await store.zadd(INDEX_KEY, { score, member: id });
  } else {
    memSet(`fit:${id}`, report, REPORT_TTL);
    if (hash) memSet(`jdhash:${hash}`, id, REPORT_TTL);
    memIndex.push({ id, score });
  }
  return id;
}

export async function getReport(id) {
  if (hasKV) {
    const store = await kv();
    return (await store.get(`fit:${id}`)) || null;
  }
  return memGet(`fit:${id}`) || null;
}

// Overwrite an existing report in place (used by admin regenerate) — keeps
// the same id and permalink, doesn't touch the dedup hash or index entry.
export async function overwriteReport(id, report) {
  if (hasKV) {
    const store = await kv();
    const opts = REPORT_TTL ? { ex: REPORT_TTL } : undefined;
    await store.set(`fit:${id}`, report, opts);
  } else {
    memSet(`fit:${id}`, report, REPORT_TTL);
  }
}

// --- Admin: list / delete ---

// Most-recent-first page of saved reports.
export async function listReports({ offset = 0, limit = 20 } = {}) {
  if (hasKV) {
    const store = await kv();
    const total = await store.zcard(INDEX_KEY);
    const ids = await store.zrange(INDEX_KEY, offset, offset + limit - 1, { rev: true });
    if (!ids.length) return { reports: [], total };
    const reports = await Promise.all(ids.map((id) => store.get(`fit:${id}`)));
    return {
      reports: ids.map((id, i) => ({ id, ...reports[i] })).filter((r) => r.created_at),
      total,
    };
  }
  const sorted = memIndex.slice().sort((a, b) => b.score - a.score);
  const page = sorted.slice(offset, offset + limit);
  return {
    reports: page.map(({ id }) => ({ id, ...(memGet(`fit:${id}`) || {}) })).filter((r) => r.created_at),
    total: memIndex.length,
  };
}

// Deletes a report, its dedup hash entry, and its index entry.
export async function deleteReport(id) {
  const report = await getReport(id);
  if (!report) return false;
  const hash = hashJD(report.job_description || "");
  if (hasKV) {
    const store = await kv();
    await store.del(`fit:${id}`);
    if (hash) await store.del(`jdhash:${hash}`);
    await store.zrem(INDEX_KEY, id);
  } else {
    memory.delete(`fit:${id}`);
    if (hash) memory.delete(`jdhash:${hash}`);
    const idx = memIndex.findIndex((e) => e.id === id);
    if (idx !== -1) memIndex.splice(idx, 1);
  }
  return true;
}

// --- Opportunities (the job pipeline) ---
//
// Stored one key per opportunity, with a sorted set indexing them by the date
// the opportunity arrived so the board lists newest first.

const JOBS_INDEX = "jobs:index";

export const JOB_STAGES = [
  "new",
  "reviewing",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "not_a_fit",
];

export async function listJobs() {
  if (hasKV) {
    const store = await kv();
    const ids = await store.zrange(JOBS_INDEX, 0, -1, { rev: true });
    if (!ids.length) return [];
    const jobs = await Promise.all(ids.map((id) => store.get(`job:${id}`)));
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

export async function getJob(id) {
  if (hasKV) {
    const store = await kv();
    const j = await store.get(`job:${id}`);
    return j ? { ...j, id } : null;
  }
  const j = memGet(`job:${id}`);
  return j ? { ...j, id } : null;
}

export async function saveJob(job) {
  const id = job.id || makeId();
  const now = new Date().toISOString();
  const record = {
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
    recruiter: job.recruiter || null,
    stage: JOB_STAGES.includes(job.stage) ? job.stage : "new",
    fitReportId: job.fitReportId || "",
    jobDescription: job.jobDescription || "",
    notes: job.notes || "",
    receivedAt: job.receivedAt || now,
    createdAt: job.createdAt || now,
    updatedAt: now,
  };
  // Index by when the opportunity arrived, not when it was imported.
  const score = new Date(record.receivedAt).getTime() || Date.now();
  if (hasKV) {
    const store = await kv();
    await store.set(`job:${id}`, record);
    await store.zadd(JOBS_INDEX, { score, member: id });
  } else {
    memSet(`job:${id}`, record, 0);
    if (!memJobIndex.some((e) => e.id === id)) memJobIndex.push({ id, score });
  }
  return { ...record, id };
}

// Partial update. Only the fields passed in are touched.
export async function updateJob(id, patch) {
  const existing = await getJob(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch, id };
  return saveJob(merged);
}

export async function deleteJob(id) {
  const existing = await getJob(id);
  if (!existing) return false;
  if (hasKV) {
    const store = await kv();
    await store.del(`job:${id}`);
    await store.zrem(JOBS_INDEX, id);
  } else {
    memory.delete(`job:${id}`);
    const i = memJobIndex.findIndex((e) => e.id === id);
    if (i !== -1) memJobIndex.splice(i, 1);
  }
  return true;
}

// Used by the inbox import so re-running it doesn't create duplicates.
// Matches on externalId first, then falls back to the Gmail thread id so rows
// imported by an earlier version of the scan still line up.
export async function findExistingJob({ externalId, threadId }) {
  if (!externalId && !threadId) return null;
  const jobs = await listJobs();
  return (
    (externalId && jobs.find((j) => j.externalId === externalId)) ||
    (threadId && jobs.find((j) => j.threadId === threadId)) ||
    null
  );
}

// Given a freshly saved analysis, find the pipeline row it belongs to. Either
// the report is already linked, or the job holds the same job description and
// just hasn't been analysed yet.
export async function findJobForReport(reportId, jd) {
  const jobs = await listJobs();
  const byReport = jobs.find((j) => j.fitReportId && j.fitReportId === reportId);
  if (byReport) return byReport;
  if (!jd) return null;
  const target = hashJD(jd);
  return jobs.find((j) => j.jobDescription && hashJD(j.jobDescription) === target) || null;
}

// Report ids that no pipeline row points at, so the admin page can offer to
// pull older analyses into the pipeline.
export async function findUnlinkedReportIds() {
  const jobs = await listJobs();
  const linked = new Set(jobs.map((j) => j.fitReportId).filter(Boolean));
  const { reports } = await listReports({ offset: 0, limit: 100 });
  return reports.filter((r) => !linked.has(r.id)).map((r) => r.id);
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
    await store.hincrby(`stats:${reportId}`, event, 1);
    await store.hset(`stats:${reportId}`, { lastAt: now });
    await store.hsetnx(`stats:${reportId}`, "firstAt", now);
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
  const ids = Array.isArray(reportIds) ? reportIds : [reportIds];
  const out = {};
  if (hasKV) {
    const store = await kv();
    await Promise.all(
      ids.map(async (id) => {
        const s = (await store.hgetall(`stats:${id}`)) || {};
        out[id] = normaliseStats(s);
      })
    );
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
export async function findReportByHash(jd) {
  const hash = hashJD(jd);
  if (!hash) return null;
  if (hasKV) {
    const store = await kv();
    const id = await store.get(`jdhash:${hash}`);
    if (!id) return null;
    const report = await store.get(`fit:${id}`);
    return report ? { id, report } : null;
  }
  const id = memGet(`jdhash:${hash}`);
  if (!id) return null;
  const report = memGet(`fit:${id}`);
  return report ? { id, report } : null;
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
