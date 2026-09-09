import { hasKV, kv } from "./kv.js";

const memory = new Map();
const TTL_SECONDS = 30 * 24 * 60 * 60;
const requestKey = (kind, jobId, requestId) => `runreq:${kind}:${jobId}:${requestId}`;
const runKey = (runId) => `runreceipt:${runId}`;
const activeKey = (kind) => `activerun:${kind}`;

export async function getReceiptForRequest(kind, jobId, requestId) {
  const key = requestKey(kind, jobId, requestId);
  return hasKV ? (await (await kv()).get(key)) || null : memory.get(key) || null;
}

export async function getRunReceipt(runId) {
  const key = runKey(runId);
  return hasKV ? (await (await kv()).get(key)) || null : memory.get(key) || null;
}

export async function saveRunReceipt(receipt) {
  const value = {
    kind: receipt.kind,
    requestId: receipt.requestId,
    runId: receipt.runId,
    jobId: receipt.jobId,
    fingerprint: receipt.fingerprint,
    ...(receipt.questionId ? { questionId: receipt.questionId } : {}),
    createdAt: receipt.createdAt || new Date().toISOString(),
  };
  const keys = [requestKey(value.kind, value.jobId, value.requestId), runKey(value.runId)];
  if (hasKV) {
    await (await kv()).pipeline()
      .set(keys[0], value, { ex: TTL_SECONDS })
      .set(keys[1], value, { ex: TTL_SECONDS })
      .exec();
  } else {
    memory.set(keys[0], value);
    memory.set(keys[1], value);
  }
  return value;
}

export async function saveActiveRun(kind, receipt) {
  const value = { kind, runId: receipt.runId, requestId: receipt.requestId,
    jobId: receipt.jobId || "batch", createdAt: receipt.createdAt || new Date().toISOString() };
  if (hasKV) await (await kv()).set(activeKey(kind), value, { ex: TTL_SECONDS });
  else memory.set(activeKey(kind), value);
  return value;
}

export async function getActiveRuns(kinds) {
  const names = [...new Set(kinds || [])];
  if (!names.length) return {};
  const values = hasKV ? await (await kv()).mget(...names.map(activeKey)) : names.map((kind) => memory.get(activeKey(kind)) || null);
  return Object.fromEntries(names.map((kind, index) => [kind, values[index] || null]));
}

export async function clearActiveRun(kind, runId) {
  const key = activeKey(kind);
  const current = hasKV ? await (await kv()).get(key) : memory.get(key);
  if (!current || current.runId !== runId) return false;
  if (hasKV) await (await kv()).del(key);
  else memory.delete(key);
  return true;
}
