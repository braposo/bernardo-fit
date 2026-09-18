import { hasKV, kv } from "./kv.js";
import { auditKey, auditEvent, appendMemoryAudit } from "./job-audit.js";
import { generationContext } from "./generation-context.js";

const memory = new Map();
const MAX_ENTRIES = 50;
const HISTORY_TTL = 30 * 86400;
const ROLLUP_TTL = 90 * 86400;
const PRICING_DATE = "2026-09-17";
// USD per million tokens, equivalent to microdollars per token.
// https://platform.claude.com/docs/en/about-claude/pricing
const PRICES = {
  // https://developers.openai.com/api/docs/models/gpt-5.6-sol
  // https://developers.openai.com/api/docs/models/gpt-6-astra
  "gpt-5.6-sol": { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
  "gpt-6-astra": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 },
};
const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
const FIELDS = ["calls", "input", "output", "cacheRead", "cacheWrite", "cacheWrite5m", "cacheWrite1h", "searches", "ms", "errors", "pricedCalls", "estimatedCostMicros"];
const dayKey = iso => "usage:day:" + (iso || new Date().toISOString()).slice(0, 10);
const breakdownKey = iso => "usage:breakdown:" + iso.slice(0, 10);

export function estimateCostMicros(entry) {
  const rates = PRICES[entry.model];
  if (!rates) return null;
  const longPrompt = entry.model.startsWith("gpt-") &&
    number(entry.input) + number(entry.cacheRead) + number(entry.cacheWrite) > 272000;
  return Math.round(Object.entries(rates).reduce((sum, [field, rate]) => {
    const multiplier = !longPrompt ? 1 : field === "output" ? 1.5 :
      field === "cacheRead" && entry.model === "gpt-5.6-sol" ? 1 : 2;
    return sum + number(entry[field]) * rate * multiplier;
  }, 0) + number(entry.searches) * 10000);
}

// A stats failure must never turn a successful generation into a retry.
export async function recordUsage({ kind, ref, model, effort, usage, ms, httpStatus = 200,
  stopReason = "", continuation = 0, generationAttempt = 1, cacheTtl = "5m", source = "model" } = {}) {
  try {
    const u = usage && typeof usage === "object" ? usage : {};
    const cacheWrite = number(u.cache_creation_input_tokens);
    const detailedCache = u.cache_creation && typeof u.cache_creation === "object";
    const entry = {
      at: new Date().toISOString(), kind: kind || "", ref: ref || "", model: model || "",
      effort: effort || "high", source,
      input: number(u.input_tokens), output: number(u.output_tokens),
      cacheRead: number(u.cache_read_input_tokens), cacheWrite,
      cacheWrite5m: detailedCache ? number(u.cache_creation.ephemeral_5m_input_tokens) : cacheTtl === "1h" ? 0 : cacheWrite,
      cacheWrite1h: detailedCache ? number(u.cache_creation.ephemeral_1h_input_tokens) : cacheTtl === "1h" ? cacheWrite : 0,
      searches: number(u.server_tool_use?.web_search_requests), ms: number(ms),
      httpStatus, stopReason, continuation, generationAttempt,
      ...generationContext(), sha: process.env.VERCEL_GIT_COMMIT_SHA || process.env.TRIGGER_GIT_COMMIT_SHA || "",
      pricingDate: PRICING_DATE,
    };
    entry.estimatedCostMicros = source === "profile" ? 0 : usage ? estimateCostMicros(entry) : null;
    const delta = { ...entry, calls: source === "profile" ? 0 : 1, errors: httpStatus >= 400 || ["max_tokens", "refusal"].includes(stopReason) ? 1 : 0,
      pricedCalls: source !== "profile" && entry.estimatedCostMicros !== null ? 1 : 0 };
    const jobId = entry.jobId || entry.reportId;
    const scope = entry.jobId ? "job" : "report";
    const jobTotals = "usage:" + scope + ":" + jobId;
    const jobGroups = "usage:" + scope + "groups:" + jobId;
    const event = auditEvent("ai.call", delta.errors ? "AI call failed" : source === "profile" ? "Answer resolved from profile facts" : "AI call completed",
      [entry.kind, entry.model, `${entry.input + entry.cacheRead + entry.cacheWrite} input · ${entry.output} output tokens`,
        entry.estimatedCostMicros === null ? "Cost unavailable" : `Estimated $${(entry.estimatedCostMicros / 1e6).toFixed(4)} USD`].join(" · "));
    const listKey = "usage:" + (ref || "unref");
    const rollupKey = dayKey(entry.at);
    const groupKey = breakdownKey(entry.at);
    const group = Buffer.from(JSON.stringify({ kind: entry.kind, model: entry.model, effort: entry.effort, source })).toString("base64url");
    if (hasKV) {
      const pipeline = (await kv()).pipeline().lpush(listKey, entry).ltrim(listKey, 0, MAX_ENTRIES - 1).expire(listKey, HISTORY_TTL);
      for (const field of FIELDS) if (delta[field]) {
        pipeline.hincrby(rollupKey, field, delta[field]);
        pipeline.hincrby(groupKey, group + ":" + field, delta[field]);
      }
      // A zero-cost fact still deserves a visible group in the breakdown.
      pipeline.hincrby(groupKey, group + ":savedCalls", source === "profile" ? 1 : 0);
      if (jobId) {
        pipeline.zadd(auditKey(scope, jobId), { score: Date.parse(event.at), member: JSON.stringify(event) });
        for (const field of FIELDS) if (delta[field]) {
          pipeline.hincrby(jobTotals, field, delta[field]);
          pipeline.hincrby(jobGroups, group + ":" + field, delta[field]);
        }
        pipeline.hincrby(jobGroups, group + ":savedCalls", source === "profile" ? 1 : 0);
      }
      pipeline.expire(rollupKey, ROLLUP_TTL).expire(groupKey, ROLLUP_TTL);
      await pipeline.exec();
    } else {
      memory.set(listKey, [entry, ...(memory.get(listKey) || [])].slice(0, MAX_ENTRIES));
      const roll = memory.get(rollupKey) || {};
      const groups = memory.get(groupKey) || {};
      for (const field of FIELDS) {
        roll[field] = (roll[field] || 0) + (delta[field] || 0);
        const key = group + ":" + field;
        groups[key] = (groups[key] || 0) + (delta[field] || 0);
      }
      groups[group + ":savedCalls"] = (groups[group + ":savedCalls"] || 0) + (source === "profile" ? 1 : 0);
      memory.set(rollupKey, roll); memory.set(groupKey, groups);
      if (jobId) {
        appendMemoryAudit(auditKey(scope, jobId), [event]);
        const totals = memory.get(jobTotals) || {}, grouped = memory.get(jobGroups) || {};
        for (const field of FIELDS) {
          totals[field] = (totals[field] || 0) + (delta[field] || 0);
          grouped[group + ":" + field] = (grouped[group + ":" + field] || 0) + (delta[field] || 0);
        }
        grouped[group + ":savedCalls"] = (grouped[group + ":savedCalls"] || 0) + (source === "profile" ? 1 : 0);
        memory.set(jobTotals, totals); memory.set(jobGroups, grouped);
      }
    }
    return entry;
  } catch (error) {
    console.error("recordUsage failed (non-fatal):", String(error).slice(0, 200));
    return null;
  }
}

export async function readUsage(ref) {
  const key = "usage:" + (ref || "unref");
  return hasKV ? (await (await kv()).lrange(key, 0, MAX_ENTRIES - 1)) || [] : memory.get(key) || [];
}

export async function dailyRollup(date) {
  const key = dayKey(date);
  const raw = hasKV ? (await (await kv()).hgetall(key)) || {} : memory.get(key) || {};
  return { date: key.slice("usage:day:".length), ...Object.fromEntries(FIELDS.map(field => [field, Number(raw[field]) || 0])) };
}

async function dailyBreakdown(date) {
  const key = breakdownKey(date);
  const raw = hasKV ? (await (await kv()).hgetall(key)) || {} : memory.get(key) || {};
  const groups = new Map();
  for (const [key, value] of Object.entries(raw)) {
    const [encoded, field] = key.split(":");
    if (![...FIELDS, "savedCalls"].includes(field)) continue;
    if (!groups.has(encoded)) groups.set(encoded, { date: date.slice(0, 10),
      ...JSON.parse(Buffer.from(encoded, "base64url").toString()),
      ...Object.fromEntries([...FIELDS, "savedCalls"].map(f => [f, 0])) });
    groups.get(encoded)[field] = Number(value) || 0;
  }
  return [...groups.values()];
}

function dates(days) {
  const count = Math.max(1, Math.min(90, Math.floor(Number(days)) || 30));
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => new Date(now - (count - i - 1) * 86400000).toISOString());
}
export const recentRollups = (days = 30) => Promise.all(dates(days).map(dailyRollup));
export const recentBreakdowns = async (days = 30) => (await Promise.all(dates(days).map(dailyBreakdown))).flat();

// Per-job totals are retained without the global rollups' rolling expiry.
export async function readJobUsage(jobId, reportIds = []) {
  const scopes = [["job", jobId], ...[...new Set(reportIds.filter(Boolean))].map(id => ["report", id])];
  const totals = {}, raw = {};
  for (const [scope, id] of scopes) {
    const keys = ["usage:" + scope + ":" + id, "usage:" + scope + "groups:" + id];
    const [values, grouped] = hasKV ? await Promise.all(keys.map(async key => (await (await kv()).hgetall(key)) || {})) : keys.map(key => memory.get(key) || {});
    for (const [key, value] of Object.entries(values)) totals[key] = (totals[key] || 0) + Number(value);
    for (const [key, value] of Object.entries(grouped)) raw[key] = (raw[key] || 0) + Number(value);
  }
  const groups = new Map();
  for (const [key, value] of Object.entries(raw)) {
    const [encoded, field] = key.split(":");
    if (![...FIELDS, "savedCalls"].includes(field)) continue;
    if (!groups.has(encoded)) groups.set(encoded, { ...JSON.parse(Buffer.from(encoded, "base64url").toString()) });
    groups.get(encoded)[field] = Number(value) || 0;
  }
  return { days: [totals], breakdown: [...groups.values()], currency: "USD" };
}
