import { hasKV, kv } from "./kv.js";
import { auditKey, appendMemoryAudit, auditEvent } from "./job-audit.js";
import { ARTIFACT_CREATE } from "./store-scripts.js";

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
  const value = { ...artifact, at: artifact.at || new Date().toISOString(), kind, jobId, id };
  const artifactKey = key(kind, jobId, id);
  const event = auditEvent("document.generated", `${kind === "research" ? "Company research" : "Interview brief"} version saved`, [value.model, id].filter(Boolean).join(" · "), { id: `${kind}-${id}`, at: value.at });
  if (hasKV) {
    const client = await kv();
    await client.eval(ARTIFACT_CREATE, [artifactKey, auditKey("job", jobId)], [JSON.stringify(value), JSON.stringify(event), event.timestamp]);
    await client.sadd(indexKey(jobId), artifactKey);
  } else if (!memory.has(artifactKey)) {
    memory.set(artifactKey, clone(value));
    appendMemoryAudit(auditKey("job", jobId), [event]);
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

export async function listScreenArtifacts(jobId, kind) {
  if (!validKind(kind) || !jobId) return [];
  let keys;
  if (hasKV) keys = await (await kv()).smembers(indexKey(jobId));
  else keys = [...(indexes.get(jobId) || [])];
  const matching = keys.filter((value) => String(value).startsWith(`screenartifact:${kind}:${jobId}:`));
  const values = hasKV && matching.length ? await (await kv()).mget(...matching) : matching.map((value) => clone(memory.get(value)));
  return values.filter(Boolean).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
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
