import { hasKV, kv } from "./kv.js";

const memory = new Map();
const TTL_SECONDS = 30 * 24 * 60 * 60;
const requestKey = (kind, jobId, requestId) => `runreq:${kind}:${jobId}:${requestId}`;
const runKey = (runId) => `runreceipt:${runId}`;

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
