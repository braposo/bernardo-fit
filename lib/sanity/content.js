import { createContentClient, SANITY_PROJECT_ID, SANITY_DATASET } from "./client.js";
import { CONTENT_COUNTS_QUERY, CANDIDATE_QUERY, JOB_CONTENT_QUERY, CONTENT_LIST_QUERY,
  CONTENT_DOCUMENT_QUERY } from "./queries.js";

export const CONTENT_TYPES = Object.freeze([
  "candidateProfile", "candidateEvidence", "job", "applicationQuestion", "fitReport",
  "coverLetter", "companyResearch", "interviewBrief", "fitAssessment", "sitePage", "writingGuidance",
]);

const invalid = message => Object.assign(new Error(message), { status: 400 });

export function validateContentType(type) {
  if (!CONTENT_TYPES.includes(type)) throw invalid("Unknown content type.");
  return type;
}

export function validateContentId(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(id)
    || id.startsWith("drafts.") || id.startsWith("versions.")) {
    throw invalid("A published document ID is required.");
  }
  return id;
}

export function contentPage(value = 0) {
  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw invalid("Invalid content offset.");
  return offset;
}

export async function contentStatus(client = createContentClient()) {
  const counts = await client.fetch(CONTENT_COUNTS_QUERY);
  return { projectId: SANITY_PROJECT_ID, dataset: SANITY_DATASET, connected: true,
    mode: "prepared", activeAppStorage: "existing", counts };
}

export async function listContent(type, offset = 0, client = createContentClient()) {
  validateContentType(type);
  const start = contentPage(offset);
  return client.fetch(CONTENT_LIST_QUERY, { type, start, end: start + 50 });
}

export async function readContent(type, id, client = createContentClient()) {
  validateContentType(type);
  validateContentId(id);
  if (type === "candidateProfile") return client.fetch(CANDIDATE_QUERY, { id });
  if (type === "job") return client.fetch(JOB_CONTENT_QUERY, { id });
  return client.fetch(CONTENT_DOCUMENT_QUERY, { type, id });
}
