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
