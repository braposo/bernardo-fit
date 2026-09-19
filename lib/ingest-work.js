import { createHash, randomUUID } from "node:crypto";
import { createJobIfAbsent, findExistingJobIn, listJobs, mutateJob, postingId } from "./store.js";
import { screenOpportunity, ingestMinimumScore } from "./ingest-screening.js";

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

export async function executeIngestBatch(opportunities, { requestId = randomUUID(), minimumScore = ingestMinimumScore(), screen = screenOpportunity } = {}) {
  if (!Number.isInteger(minimumScore) || minimumScore < 0 || minimumScore > 100) throw Object.assign(new Error("Invalid ingestion score threshold."), { abort: true });
  const jobs = await listJobs({ includeArchived: true });
  let added = 0, updated = 0, skipped = 0, filtered = 0, needsReview = 0, failed = 0;
  const addedRows = [], mergedRows = [], screeningRows = [];
  const entries = opportunities.map(raw => {
    const opp = raw && typeof raw === "object" ? cleanOpportunity(raw) : null;
    return opp && (opp.company || opp.role) && (opp.externalId || opp.threadId) ? opp : null;
  });
  const assessments = new Map();
  const candidates = entries.map((opp, index) => ({ opp, index })).filter(({ opp }) => opp && !findExistingJobIn(jobs, opp));
  // At most four plain HTTP evaluations at a time. This keeps a 200-row batch
  // within the worker budget even when individual requests hit their timeout.
  for (let start = 0; start < candidates.length; start += 4) {
    await Promise.all(candidates.slice(start, start + 4).map(async ({ opp, index }) => {
      assessments.set(index, await screen(opp, { requestId, minimumScore }));
    }));
  }

  for (const [index, opp] of entries.entries()) {
    if (!opp) { skipped++; continue; }
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
    const screening = assessments.get(index);
    if (screening?.decision !== "accepted") {
      const decision = screening?.decision || "evaluation-failed";
      if (decision === "needs-review") needsReview++;
      else if (decision === "evaluation-failed") failed++;
      else filtered++;
      screeningRows.push({ company: opp.company || "", role: opp.role || "", externalId: opp.externalId || "",
        sourceUrl: opp.sourceUrl || "", decision, score: screening?.assessment?.score ?? null,
        postingQuality: screening?.assessment?.posting?.choice || "",
        missingDimensions: (screening?.assessment?.dimensions || []).filter(d => d.score === null).map(d => d.label),
        ...(screening?.error ? { error: screening.error } : {}) });
      continue;
    }
    const id = ingestIdentity(opp);
    const row = await createJobIfAbsent(id, { ...opp, stage: "new", jevAssessment: screening.assessment });
    const alreadyLoaded = jobs.some((job) => job.id === row.id);
    if (alreadyLoaded) updated++;
    else {
      jobs.push(row); added++;
      addedRows.push({ id: row.id, company: row.company, role: row.role, score: row.jevAssessment?.score ?? null });
    }
  }
  return { added, updated, skipped, filtered, needsReview, failed, minimumScore, addedRows, mergedRows, screeningRows };
}
