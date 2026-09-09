import { hasKV, kv } from "./kv.js";

const memory = new Map();
const indexes = new Map();
const clone = (v) => v == null ? v : structuredClone(v);
const key = (kind, ownerId, requestId) => `taskresult:${kind}:${ownerId}:${requestId}`;
const indexKey = (ownerId) => `taskresults:${ownerId}`;

export async function getTaskResult(kind, ownerId, requestId) {
  if (!kind || !ownerId || !requestId) return null;
  const k = key(kind, ownerId, requestId);
  return hasKV ? (await (await kv()).get(k)) || null : clone(memory.get(k)) || null;
}

export async function saveTaskResult(kind, ownerId, requestId, value) {
  const k = key(kind, ownerId, requestId);
  if (hasKV) {
    const client = await kv();
    await client.set(k, value, { nx: true });
    await client.sadd(indexKey(ownerId), k);
  } else if (!memory.has(k)) {
    memory.set(k, clone(value));
    const set = indexes.get(ownerId) || new Set();
    set.add(k); indexes.set(ownerId, set);
  }
  return getTaskResult(kind, ownerId, requestId);
}

export async function deleteTaskResults(ownerId) {
  if (hasKV) {
    const client = await kv();
    const keys = await client.smembers(indexKey(ownerId));
    if (keys.length) await client.del(...keys);
    await client.del(indexKey(ownerId));
    return keys.length;
  }
  const keys = [...(indexes.get(ownerId) || [])];
  for (const k of keys) memory.delete(k);
  indexes.delete(ownerId);
  return keys.length;
}

const inputs = new Map();
const inputKey = (kind, requestId) => `taskinput:${kind}:${requestId}`;
export async function saveTaskInput(kind, requestId, value) {
  const k = inputKey(kind, requestId);
  if (hasKV) await (await kv()).set(k, value, { nx: true, ex: 30 * 24 * 60 * 60 });
  else if (!inputs.has(k)) inputs.set(k, clone(value));
  return getTaskInput(kind, requestId);
}
export async function getTaskInput(kind, requestId) {
  const k = inputKey(kind, requestId);
  return hasKV ? (await (await kv()).get(k)) || null : clone(inputs.get(k)) || null;
}
