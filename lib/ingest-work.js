import { createHash, randomUUID } from "node:crypto";
import { createJobIfAbsent, findExistingJobIn, linkedinPostingId, listJobs, mutateJob, postingId } from "./store.js";
import { screenOpportunity, ingestMinimumScore } from "./ingest-screening.js";
import { recordFilteredJobs, listFilteredForMatching, filteredDescription, recordFilteredRepost } from "./filtered-jobs.js";
import { checkRepeat, recordJobRepost, repostEntry } from "./job-duplicates.js";

// Storage and Jev behind the repost check, replaceable in tests.
export const repeatStore = {
  listFiltered: listFilteredForMatching, check: checkRepeat,
  describe: record => record.kind === "filtered" ? filteredDescription(record.id) : record.jobDescription || "",
  record: (match, entry) => match.repeat.kind === "filtered"
    ? recordFilteredRepost(match.repeat.id, entry) : recordJobRepost(match.repeat.id, entry),
};

// Pipeline and archived rows first, so a repost lands on the live row.
export const repeatRecords = (jobs, filtered) => [...jobs.map(job => ({ ...job, kind: "job" })), ...filtered];

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
  const linkedInId = linkedinPostingId(opp);
  const companyRole = normalise(opp.company) && normalise(opp.role)
    ? `role:${normalise(opp.company)}:${normalise(opp.role)}` : "";
  const stable = (linkedInId ? `linkedin-posting:${linkedInId}` : "") || companyRole ||
    (postingId(opp.sourceUrl) ? `posting:${postingId(opp.sourceUrl)}` : "") ||
    (opp.externalId ? `external:${opp.externalId}` : `thread:${opp.threadId}`);
  return "ing_" + createHash("sha256").update(stable).digest("hex").slice(0, 20);
}

export async function executeIngestBatch(opportunities, { requestId = randomUUID(), minimumScore = ingestMinimumScore(), screen = screenOpportunity, skipExisting = false, recordFiltered = recordFilteredJobs, repeats = repeatStore } = {}) {
  if (!Number.isInteger(minimumScore) || minimumScore < 0 || minimumScore > 100) throw Object.assign(new Error("Invalid ingestion score threshold."), { abort: true });
  const jobs = await listJobs({ includeArchived: true });
  let added = 0, updated = 0, skipped = 0, filtered = 0, needsReview = 0, failed = 0;
  const addedRows = [], mergedRows = [], screeningRows = [], filteredEntries = [];
  const entries = opportunities.map(raw => {
    const opp = raw && typeof raw === "object" ? cleanOpportunity(raw) : null;
    return opp && (opp.company || opp.role) && (opp.externalId || opp.threadId) ? opp : null;
  });
  const forRecord = index => ({ ...entries[index], ...(opportunities[index]?.postedDate ? { postedDate: opportunities[index].postedDate } : {}) });
  const assessments = new Map();
  let candidates = entries.map((opp, index) => ({ opp, index })).filter(({ opp }) => opp && !findExistingJobIn(jobs, opp));
  // A new listing of an opening already in the pipeline, archive or Filtered is
  // recorded on that record and never assessed again.
  let repeated = 0;
  const repeatedRows = [], repeatFailures = new Map();
  if (candidates.length && repeats) {
    const records = repeatRecords(jobs, await repeats.listFiltered());
    const fresh = [];
    for (const candidate of candidates) {
      const posting = forRecord(candidate.index);
      let match;
      try { match = await repeats.check(posting, records, { describe: repeats.describe }); }
      catch (error) {
        if (error.fatal) throw error;
        repeatFailures.set(candidate.index, error.message);
        continue;
      }
      if (!match) { fresh.push(candidate); continue; }
      await repeats.record(match, repostEntry(posting, match));
      repeated++;
      repeatedRows.push({ company: posting.company || "", role: posting.role || "", externalId: posting.externalId || "",
        repeatOf: match.repeat.id, kind: match.repeat.kind, by: match.by,
        ...(Number.isFinite(match.probability) ? { probability: match.probability } : {}) });
    }
    candidates = fresh;
  }
  const settled = new Set([...repeatFailures.keys(), ...candidates.map(c => c.index)]);
  // Trigger durable waits cannot be placed inside Promise.all. The provider
  // task queue owns cross-run concurrency; this orchestration remains sequential.
  for (const {opp,index} of candidates) {
    assessments.set(index, await screen(opp, {requestId,minimumScore}));
  }

  for (const [index, opp] of entries.entries()) {
    if (!opp) { skipped++; continue; }
    const existing = findExistingJobIn(jobs, opp);
    if (existing) {
      if (skipExisting) { skipped++; continue; }
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
    if (!settled.has(index)) continue;
    if (repeatFailures.has(index)) {
      failed++;
      screeningRows.push({ company: opp.company || "", role: opp.role || "", externalId: opp.externalId || "",
        sourceUrl: opp.sourceUrl || "", decision: "repeat-check-failed", score: null, postingQuality: "",
        missingDimensions: [], error: repeatFailures.get(index) });
      continue;
    }
    const screening = assessments.get(index);
    if (screening?.decision !== "accepted") {
      const decision = screening?.decision || "evaluation-failed";
      if (decision === "needs-review") needsReview++;
      else if (["evaluation-failed", "summary-failed"].includes(decision)) failed++;
      else filtered++;
      screeningRows.push({ company: opp.company || "", role: opp.role || "", externalId: opp.externalId || "",
        sourceUrl: opp.sourceUrl || "", decision, score: screening?.assessment?.score ?? null,
        postingQuality: screening?.assessment?.posting?.choice || "",
        missingDimensions: (screening?.assessment?.dimensions || []).filter(d => d.evidenceLimited || d.score === null).map(d => d.label),
        ...(screening?.error ? { error: screening.error } : {}) });
      // Keep scored rejections reviewable. Unscored ones (unreadable postings)
      // are dropped, and failed evaluations retry instead.
      if (["below-threshold", "constraint-conflict"].includes(decision) && Number.isFinite(screening.assessment?.score))
        filteredEntries.push({ opportunity: forRecord(index), decision, assessment: screening.assessment, minimumScore });
      continue;
    }
    const id = ingestIdentity(opp);
    const row = await createJobIfAbsent(id, { ...opp, stage: "new", jevAssessment: screening.assessment,
      overviewSummary: screening.overviewSummary });
    const alreadyLoaded = jobs.some((job) => job.id === row.id);
    if (alreadyLoaded) updated++;
    else {
      jobs.push(row); added++;
      addedRows.push({ id: row.id, company: row.company, role: row.role, score: row.jevAssessment?.score ?? null });
    }
  }
  const filteredRecords = filteredEntries.length ? await recordFiltered(filteredEntries) : { recorded: 0, failures: [] };
  return { added, updated, skipped, filtered, repeated, needsReview, failed, minimumScore, addedRows, mergedRows, screeningRows, repeatedRows,
    filteredRecorded: filteredRecords.recorded, filteredRecordFailures: filteredRecords.failures };
}
