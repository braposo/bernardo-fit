// Records what each model call actually cost, so every later optimisation has
// a real number to work from instead of a guess. Nothing here changes what a
// generator does; it only writes down what happened after the fact.
//
// A stats write must never fail a generation — recordUsage swallows its own
// errors rather than let a KV hiccup turn a good analysis into a 500.

const hasKV =
  !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

const memory = new Map();

async function kv() {
  const mod = await import("@vercel/kv");
  return mod.kv;
}

function memList(key) {
  return memory.get(key) || [];
}

function memRollup(key) {
  return memory.get(key) || {};
}

const MAX_ENTRIES = 50;

// One record per model call: what it cost, in the shape the API reports it.
// Everything numeric defaults to 0 so a partial `usage` object (a refusal, a
// tool error) still produces a record rather than a throw.
function buildEntry({ kind, ref, model, effort, usage, ms }) {
  const u = usage || {};
  const searches = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
  return {
    at: new Date().toISOString(),
    kind: kind || "",
    ref: ref || "",
    model: model || "",
    effort: effort || "",
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    searches,
    ms: typeof ms === "number" ? Math.round(ms) : 0,
    sha: process.env.VERCEL_GIT_COMMIT_SHA || "",
  };
}

const ROLLUP_FIELDS = ["calls", "input", "output", "cacheRead", "cacheWrite", "searches", "ms"];

function dayKey(iso) {
  return "usage:day:" + (iso || new Date().toISOString()).slice(0, 10);
}

export async function recordUsage({ kind, ref, model, effort, usage, ms } = {}) {
  try {
    const entry = buildEntry({ kind, ref, model, effort, usage, ms });
    const listKey = "usage:" + (ref || "unref");
    const rollupKey = dayKey(entry.at);
    const rollupDelta = { calls: 1, input: entry.input, output: entry.output, cacheRead: entry.cacheRead, cacheWrite: entry.cacheWrite, searches: entry.searches, ms: entry.ms };

    if (hasKV) {
      const store = await kv();
      await store.lpush(listKey, entry);
      await store.ltrim(listKey, 0, MAX_ENTRIES - 1);
      for (const f of ROLLUP_FIELDS) {
        if (rollupDelta[f]) await store.hincrby(rollupKey, f, rollupDelta[f]);
      }
    } else {
      const list = [entry, ...memList(listKey)].slice(0, MAX_ENTRIES);
      memory.set(listKey, list);
      const roll = memRollup(rollupKey);
      for (const f of ROLLUP_FIELDS) roll[f] = (roll[f] || 0) + rollupDelta[f];
      memory.set(rollupKey, roll);
    }
    return entry;
  } catch (err) {
    console.error("recordUsage failed (non-fatal):", String(err).slice(0, 200));
    return null;
  }
}

export async function readUsage(ref) {
  const listKey = "usage:" + (ref || "unref");
  if (hasKV) {
    const store = await kv();
    return (await store.lrange(listKey, 0, MAX_ENTRIES - 1)) || [];
  }
  return memList(listKey);
}

export async function dailyRollup(date) {
  const rollupKey = dayKey(date || new Date().toISOString());
  if (hasKV) {
    const store = await kv();
    const raw = (await store.hgetall(rollupKey)) || {};
    const out = { date: rollupKey.slice("usage:day:".length) };
    for (const f of ROLLUP_FIELDS) out[f] = Number(raw[f]) || 0;
    return out;
  }
  const raw = memRollup(rollupKey);
  const out = { date: rollupKey.slice("usage:day:".length) };
  for (const f of ROLLUP_FIELDS) out[f] = raw[f] || 0;
  return out;
}

// The last N days, oldest first, so a chart can read left to right without
// sorting. Days with no calls still appear, at zero, so a gap is visible
// rather than absent.
export async function recentRollups(days = 30) {
  const out = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const iso = new Date(now - i * 86400000).toISOString();
    out.push(await dailyRollup(iso));
  }
  return out;
}
