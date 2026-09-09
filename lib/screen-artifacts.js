import { hasKV, kv } from "./kv.js";

const memory = new Map();
const indexes = new Map();
const clone = (v) => v == null ? v : structuredClone(v);
const key = (kind, jobId, id) => `screenartifact:${kind}:${jobId}:${id}`;
const indexKey = (jobId) => `screenartifacts:${jobId}`;

function validKind(kind) { return kind === "research" || kind === "brief"; }

export async function getScreenArtifact(kind, jobId, id) {
  if (!validKind(kind) || !jobId || !id) return null;
  return hasKV ? (await (await kv()).get(key(kind, jobId, id))) || null : clone(memory.get(key(kind, jobId, id))) || null;
}

export async function saveScreenArtifact(kind, jobId, id, artifact) {
  if (!validKind(kind) || !jobId || !id || !artifact) throw Object.assign(new Error("Invalid screen artifact"), { status: 400 });
  const value = { ...artifact, kind, jobId, id };
  const artifactKey = key(kind, jobId, id);
  if (hasKV) {
    const client = await kv();
    await client.set(artifactKey, value, { nx: true });
    await client.sadd(indexKey(jobId), artifactKey);
  } else if (!memory.has(artifactKey)) {
    memory.set(artifactKey, clone(value));
    const ids = indexes.get(jobId) || new Set();
    ids.add(artifactKey); indexes.set(jobId, ids);
  }
  return getScreenArtifact(kind, jobId, id);
}

export async function getActiveResearch(job) {
  return job?.researchId ? getScreenArtifact("research", job.id, job.researchId) : null;
}

export async function getActiveBrief(job) {
  return job?.briefId ? getScreenArtifact("brief", job.id, job.briefId) : null;
}

export async function deleteScreenArtifacts(jobId) {
  if (hasKV) {
    const client = await kv();
    const keys = await client.smembers(indexKey(jobId));
    if (keys.length) await client.del(...keys);
    await client.del(indexKey(jobId));
    return keys.length;
  }
  const keys = [...(indexes.get(jobId) || [])];
  for (const k of keys) memory.delete(k);
  indexes.delete(jobId);
  return keys.length;
}
