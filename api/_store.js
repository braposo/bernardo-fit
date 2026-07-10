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

// --- In-memory fallback (dev only) ---
const memory = new Map(); // key -> { value, expiresAt }

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
  if (hasKV) {
    const store = await kv();
    const opts = REPORT_TTL ? { ex: REPORT_TTL } : undefined;
    await store.set(`fit:${id}`, report, opts);
    if (hash) await store.set(`jdhash:${hash}`, id, opts);
  } else {
    memSet(`fit:${id}`, report, REPORT_TTL);
    if (hash) memSet(`jdhash:${hash}`, id, REPORT_TTL);
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
