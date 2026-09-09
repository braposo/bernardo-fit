import { createHash } from "node:crypto";
import { createJobIfAbsent, findExistingJobIn, listJobs, mutateJob, postingId } from "./store.js";

export const INGEST_ALLOWED = [
  "externalId", "company", "role", "source", "sourceType", "sourceUrl",
  "threadId", "location", "locationMode", "salary", "jobDescription",
  "receivedAt", "notes", "replyOwed", "recruiter", "closed",
];

export function cleanOpportunity(raw) {
  const out = {};
  for (const key of INGEST_ALLOWED) if (raw?.[key] !== undefined) out[key] = raw[key];
  return out;
}

const normalise = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function ingestIdentity(opp) {
  const companyRole = normalise(opp.company) && normalise(opp.role)
    ? `role:${normalise(opp.company)}:${normalise(opp.role)}` : "";
  const stable = companyRole || (postingId(opp.sourceUrl) ? `posting:${postingId(opp.sourceUrl)}` : "") ||
    (opp.externalId ? `external:${opp.externalId}` : `thread:${opp.threadId}`);
  return "ing_" + createHash("sha256").update(stable).digest("hex").slice(0, 20);
}

export async function executeIngestBatch(opportunities) {
  const jobs = await listJobs({ includeArchived: true });
  let added = 0, updated = 0, skipped = 0;
  const addedRows = [], mergedRows = [];

  for (const raw of opportunities) {
    if (!raw || typeof raw !== "object") { skipped++; continue; }
    const opp = cleanOpportunity(raw);
    if ((!opp.company && !opp.role) || (!opp.externalId && !opp.threadId)) { skipped++; continue; }
    const existing = findExistingJobIn(jobs, opp);
    if (existing) {
      if (opp.externalId && existing.externalId !== opp.externalId) {
        const pid = postingId(opp.sourceUrl);
        mergedRows.push({ id: existing.id, company: existing.company, role: existing.role, sentAs: opp.externalId,
          matchedOn: pid && postingId(existing.sourceUrl) === pid ? "posting id" : "company and role" });
      }
      const row = await mutateJob(existing.id, (current) => ({
        ...opp,
        stage: current.stage, notes: current.notes || opp.notes || "", fitReportId: current.fitReportId,
        archived: current.archived, archivedAt: current.archivedAt, createdAt: current.createdAt,
        score: current.score, tier: current.tier, scoreBreakdown: current.scoreBreakdown, rationale: current.rationale,
        jobDescription: (opp.jobDescription || "").length > (current.jobDescription || "").length
          ? opp.jobDescription : current.jobDescription,
      }));
      Object.assign(existing, row);
      updated++;
      continue;
    }
    const id = ingestIdentity(opp);
    const row = await createJobIfAbsent(id, { ...opp, stage: "new" });
    const alreadyLoaded = jobs.some((job) => job.id === row.id);
    if (alreadyLoaded) updated++;
    else {
      jobs.push(row); added++;
      addedRows.push({ id: row.id, company: row.company, role: row.role });
    }
  }
  return { added, updated, skipped, addedRows, mergedRows };
}
