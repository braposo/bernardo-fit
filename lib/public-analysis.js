import { createHmac, timingSafeEqual } from "node:crypto";
import { analysisContext } from "./analyze.js";
import { digest } from "./generation-fingerprint.js";
import { hasKV, kv } from "./kv.js";
import { PUBLIC_MODEL } from "./models.js";
import { PUBLIC_ANALYSIS_ADMIT, PUBLIC_ANALYSIS_RELEASE } from "./store-scripts.js";
import { hashJD } from "./store.js";

const RECEIPT_TTL = 24 * 60 * 60;
const CLAIM_TTL = 60 * 60;
const memory = new Map();
const counters = new Map();
const receiptKey = (id) => `publicrun:${id}`;
const claimKey = (fingerprint) => `publicclaim:${fingerprint}`;
const nowSeconds = () => Math.floor(Date.now() / 1000);

function envInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function publicAnalysisLimits(env = process.env) {
  return {
    maxCharacters: envInt(env.PUBLIC_ANALYSIS_MAX_CHARS, 20_000, 1_000, 100_000),
    perIpHourly: envInt(env.PUBLIC_ANALYSIS_IP_HOURLY_LIMIT, 10, 1, 1_000),
    uniqueDaily: envInt(env.PUBLIC_ANALYSIS_DAILY_LIMIT, 60, 1, 100_000),
  };
}

export function publicAnalysisFingerprint(jd) {
  return digest({ posting: hashJD(jd), model: PUBLIC_MODEL, generation: analysisContext() });
}

function secret(env = process.env) {
  const value = env.PUBLIC_RUN_SECRET || env.ADMIN_SECRET;
  if (!value) throw Object.assign(new Error("Public run tokens are not configured."), { status: 503 });
  return value;
}

export function publicClientKey(ip, env = process.env) {
  return createHmac("sha256", secret(env)).update(String(ip || "unknown")).digest("hex").slice(0, 24);
}

export function createPublicRunToken(requestId, env = process.env, expiresAt = nowSeconds() + RECEIPT_TTL) {
  const expiry = String(expiresAt);
  const signature = createHmac("sha256", secret(env)).update(`${requestId}.${expiry}`).digest("base64url");
  return `${expiry}.${signature}`;
}

export function verifyPublicRunToken(requestId, token, env = process.env) {
  const [expiry, supplied, extra] = String(token || "").split(".");
  if (!expiry || !supplied || extra || !/^\d+$/.test(expiry) || Number(expiry) < nowSeconds()) return false;
  const expected = createHmac("sha256", secret(env)).update(`${requestId}.${expiry}`).digest("base64url");
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function memoryGet(key) {
  const item = memory.get(key);
  if (!item || (item.expiresAt && item.expiresAt <= Date.now())) { memory.delete(key); return null; }
  return structuredClone(item.value);
}
function memorySet(key, value, ttl = RECEIPT_TTL) {
  memory.set(key, { value: structuredClone(value), expiresAt: Date.now() + ttl * 1000 });
}

export async function getPublicRunReceipt(requestId) {
  return hasKV ? (await (await kv()).get(receiptKey(requestId))) || null : memoryGet(receiptKey(requestId));
}

export async function savePublicRunReceipt(receipt) {
  const value = {
    kind: "public-analysis", requestId: receipt.requestId, fingerprint: receipt.fingerprint,
    inputId: receipt.inputId, runId: receipt.runId || "", status: receipt.status || "dispatching",
    admittedAt: receipt.admittedAt || new Date().toISOString(),
  };
  if (hasKV) await (await kv()).set(receiptKey(value.requestId), value, { ex: RECEIPT_TTL });
  else memorySet(receiptKey(value.requestId), value);
  return value;
}

export async function admitPublicAnalysis({ fingerprint, requestId, clientKey, limits = publicAnalysisLimits(), now = Date.now() }) {
  const hour = Math.floor(now / 1000 / 3600);
  const day = new Date(now).toISOString().slice(0, 10);
  const ipTtl = 3600 - (Math.floor(now / 1000) % 3600);
  const dayTtl = Math.max(1, Math.ceil((Date.parse(`${day}T00:00:00.000Z`) + 86400000 - now) / 1000));
  if (hasKV) {
    const result = await (await kv()).eval(PUBLIC_ANALYSIS_ADMIT,
      [claimKey(fingerprint), `publicrl:${clientKey}:${hour}`, `publicdaily:${day}`],
      [requestId, limits.perIpHourly, limits.uniqueDaily, CLAIM_TTL, ipTtl, dayTtl]);
    const code = Number(result?.[0]);
    if (code === 0) return { allowed: false, reason: String(result[1]), retryAfter: Math.max(1, Number(result[2]) || 60) };
    return { allowed: true, requestId: String(result[1]), shared: code === 2 };
  }
  const active = memoryGet(claimKey(fingerprint));
  if (active) return { allowed: true, requestId: active, shared: true };
  const ipKey = `publicrl:${clientKey}:${hour}`; const dayKey = `publicdaily:${day}`;
  const ipCount = counters.get(ipKey) || 0; const dayCount = counters.get(dayKey) || 0;
  if (ipCount >= limits.perIpHourly) return { allowed: false, reason: "ip", retryAfter: ipTtl };
  if (dayCount >= limits.uniqueDaily) return { allowed: false, reason: "day", retryAfter: dayTtl };
  memorySet(claimKey(fingerprint), requestId, CLAIM_TTL);
  counters.set(ipKey, ipCount + 1); counters.set(dayKey, dayCount + 1);
  return { allowed: true, requestId, shared: false };
}

export async function releasePublicAnalysisClaim(fingerprint, requestId) {
  if (hasKV) return Number(await (await kv()).eval(PUBLIC_ANALYSIS_RELEASE, [claimKey(fingerprint)], [requestId])) === 1;
  if (memoryGet(claimKey(fingerprint)) !== requestId) return false;
  memory.delete(claimKey(fingerprint)); return true;
}
