import { createHash } from "node:crypto";
import { hasKV, kv } from "./kv.js";
import { COVER_INDEX_WRITE } from "./store-scripts.js";

const MAX_VERSIONS = 10;
const memoryArtifacts = new Map();
const memoryIndexes = new Map();
const memoryRevisions = new Map();
const artifactKey = (jobId, vid) => `coverartifact:${jobId}:${vid}`;
const indexKey = (jobId) => `coverindex:${jobId}`;
const revisionKey = (jobId) => `coverindexrev:${jobId}`;
const clone = (value) => value == null ? value : structuredClone(value);

function metadata(artifact) {
  return {
    vid: artifact.vid,
    at: artifact.at || "",
    model: artifact.model || "",
    words: Number(artifact.words) || 0,
    salutation: artifact.salutation || "",
  };
}

function normaliseArtifact(jobId, artifact) {
  return {
    jobId,
    vid: String(artifact.vid || ""),
    at: artifact.at || new Date().toISOString(),
    model: artifact.model || "",
    words: Number(artifact.words) || 0,
    salutation: artifact.salutation || "",
    paragraphs: Array.isArray(artifact.paragraphs) ? artifact.paragraphs : [],
  };
}

async function getIndexState(jobId) {
  if (hasKV) {
    const client = await kv();
    const [index, revision] = await Promise.all([
      client.get(indexKey(jobId)), client.get(revisionKey(jobId)),
    ]);
    return { index: index && Array.isArray(index.versions) ? index : { versions: [] }, revision: Number(revision) || 0 };
  }
  return {
    index: clone(memoryIndexes.get(jobId)) || { versions: [] },
    revision: memoryRevisions.get(jobId) || 0,
  };
}

async function changeIndex(jobId, mutate) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const { index, revision } = await getIndexState(jobId);
    const next = mutate(index);
    if (!next) return index;
    let saved;
    if (hasKV) {
      saved = await (await kv()).eval(COVER_INDEX_WRITE,
        [indexKey(jobId), revisionKey(jobId)], [revision, JSON.stringify(next)]);
    } else {
      saved = (memoryRevisions.get(jobId) || 0) === revision;
      if (saved) {
        memoryIndexes.set(jobId, clone(next));
        memoryRevisions.set(jobId, revision + 1);
      }
    }
    if (saved) return next;
  }
  throw Object.assign(new Error("Cover history changed while saving. Please retry."), { status: 409 });
}

export async function getCoverArtifact(jobId, vid) {
  if (!jobId || !vid) return null;
  return hasKV
    ? (await (await kv()).get(artifactKey(jobId, vid))) || null
    : clone(memoryArtifacts.get(artifactKey(jobId, vid))) || null;
}

export async function saveCoverArtifact(jobId, value, { preserveId = "" } = {}) {
  const artifact = normaliseArtifact(jobId, value);
  if (!artifact.vid || !artifact.paragraphs.length) throw Object.assign(new Error("Invalid cover artifact"), { status: 400 });
  const key = artifactKey(jobId, artifact.vid);
  if (hasKV) await (await kv()).set(key, artifact, { nx: true });
  else if (!memoryArtifacts.has(key)) memoryArtifacts.set(key, clone(artifact));
  const persisted = await getCoverArtifact(jobId, artifact.vid);
  const index = await changeIndex(jobId, (current) => {
    const all = [metadata(persisted), ...current.versions.filter((v) => v.vid !== persisted.vid)]
      .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
    let versions = all.slice(0, MAX_VERSIONS);
    if (preserveId && !versions.some((v) => v.vid === preserveId)) {
      const preserved = all.find((v) => v.vid === preserveId);
      if (preserved) versions[versions.length - 1] = preserved;
    }
    return { versions };
  });
  return { artifact: persisted, versionCount: index.versions.length };
}

function legacyArtifacts(job) {
  const versions = (job.coverLetterVersions || [])
    .filter((v) => v?.vid && Array.isArray(v.paragraphs) && v.paragraphs.length)
    .map((v) => normaliseArtifact(job.id, v));
  if (Array.isArray(job.coverLetter) && job.coverLetter.length) {
    const body = JSON.stringify(job.coverLetter);
    const matched = versions.find((v) => JSON.stringify(v.paragraphs) === body);
    if (!matched) {
      const suffix = createHash("sha256").update(JSON.stringify(job.coverLetter)).digest("hex").slice(0, 16);
      versions.unshift(normaliseArtifact(job.id, {
        vid: `legacy${suffix}`, at: job.coverLetterAt, model: job.coverLetterModel,
        words: job.coverLetterWords, salutation: job.coverLetterSalutation, paragraphs: job.coverLetter,
      }));
    }
  }
  return versions;
}

export async function migrateLegacyCoverArtifacts(job) {
  const legacy = legacyArtifacts(job);
  const activeLegacy = (job.coverLetterVersions || []).find((v) => v.active)?.vid || legacy[0]?.vid || "";
  for (const artifact of [...legacy].reverse()) {
    await saveCoverArtifact(job.id, artifact, { preserveId: job.coverLetterId || activeLegacy });
  }
  return { activeId: job.coverLetterId || activeLegacy, migrated: legacy.length };
}

export async function listCoverVersions(job) {
  const { index } = await getIndexState(job.id);
  if (index.versions.length) {
    const activeId = job.coverLetterId || (job.coverLetterVersions || []).find((v) => v.active)?.vid || "";
    return index.versions.map((v) => ({ ...v, active: v.vid === activeId }));
  }
  const legacy = legacyArtifacts(job);
  const activeId = (job.coverLetterVersions || []).find((x) => x.active)?.vid || legacy[0]?.vid || "";
  return legacy.map((v) => ({ ...metadata(v), active: v.vid === activeId }));
}

export async function getActiveCoverArtifact(job) {
  if (!job) return null;
  if (job.coverLetterId) {
    const artifact = await getCoverArtifact(job.id, job.coverLetterId);
    if (artifact) return artifact;
  }
  if (Array.isArray(job.coverLetter) && job.coverLetter.length) {
    return normaliseArtifact(job.id, {
      vid: job.coverLetterId || "legacy", at: job.coverLetterAt, model: job.coverLetterModel,
      words: job.coverLetterWords, salutation: job.coverLetterSalutation, paragraphs: job.coverLetter,
    });
  }
  return null;
}

export async function deleteCoverArtifacts(jobId) {
  const { index } = await getIndexState(jobId);
  const keys = index.versions.map((v) => artifactKey(jobId, v.vid));
  if (hasKV) {
    await (await kv()).del(...keys, indexKey(jobId), revisionKey(jobId));
  } else {
    for (const key of keys) memoryArtifacts.delete(key);
    memoryIndexes.delete(jobId);
    memoryRevisions.delete(jobId);
  }
  return keys.length;
}
