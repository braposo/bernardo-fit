import { researchFingerprint } from "./generation-fingerprint.js";
import { scoringFingerprint } from "./jev-scoring.js";

// Explicit HTTP projections. New stored fields are private until selected here.
const SUMMARY_FIELDS = ["id", "revision", "company", "role", "source", "sourceType", "sourceUrl", "threadId",
  "location", "locationMode", "salary", "replyOwed",
  "userViewed", "closed", "archived", "archivedAt", "stage", "fitReportId", "receivedAt", "createdAt", "updatedAt",
  "coverLetterId", "coverLetterAt", "coverLetterModel", "coverLetterWords", "coverLetterVersionCount", "coverRun",
  "researchId", "researchAt", "researchModel", "researchSourceCount", "researchPartial", "researchFingerprint", "researchRun",
  "briefId", "briefAt", "briefModel", "briefFingerprint", "briefStage", "briefRun", "prepareRun", "analysisRun"];

export function jobSummary(job) {
  const out = Object.fromEntries(SUMMARY_FIELDS.filter(k => job[k] !== undefined).map(k => [k, job[k]]));
  Object.assign(out, { score: null, tier: "", scoreBreakdown: null, rationale: "" });
  out.jevRun = job.jevRun || null;
  out.jevAssessment = job.jevAssessment || null;
  out.jevStale = !!job.jevAssessment && job.jevAssessment.fingerprint !== scoringFingerprint(job);
  if (job.jevAssessment) {
    out.score = out.jevStale ? null : job.jevAssessment.score;
    out.tier = out.jevStale ? "Needs reassessment" : job.jevAssessment.blocked ? "Constraint conflict" :
      out.score === null ? "Needs more information" : out.score >= 80 ? "Act now" : out.score >= 58 ? "Worth a look" : out.score >= 40 ? "Background" : "Off-target";
    out.scoreBreakdown = Object.fromEntries(job.jevAssessment.dimensions.map(d => [d.id, out.jevStale ? null : d.score]));
    out.rationale = "";
  }
  out.recruiter = job.recruiter ? {
    name: job.recruiter.name || "", org: job.recruiter.org || "", daysWaiting: job.recruiter.daysWaiting ?? null,
  } : null;
  out.hasDescription = !!job.jobDescription;
  out.analysisReady = !!job.fitReportId || String(job.jobDescription || "").trim().length >= 20;
  out.hasInstructions = !!job.instructions;
  out.hasNotes = !!job.notes;
  out.hasCoverLetter = !!job.coverLetterId || !!job.coverLetter;
  out.hasResearch = !!job.researchId;
  out.hasBrief = !!job.briefId;
  out.researchStale = !!job.researchId && (job.researchFingerprint !== researchFingerprint(job) ||
    Date.now() - (Date.parse(job.researchAt) || 0) > 7 * 24 * 60 * 60 * 1000);
  out.briefStale = !!job.briefId && !job.briefFingerprint;
  out.letterVersionCount = Number(job.coverLetterVersionCount) || (job.coverLetterVersions || []).length;
  out.questionCount = (job.questions || []).length;
  out.answeredCount = (job.questions || []).filter(q => q.a || q.refused).length;
  out.answerRuns = (job.questions || []).filter(q => q.run?.runId &&
    ["dispatching", "queued"].includes(q.run.status)).map(q => ({ questionId: q.id, run: q.run }));
  return out;
}

export function jobDetail(job) {
  const summary = job.overviewSummary;
  const current = summary && summary.fingerprint === scoringFingerprint(job) && summary.assessedAt === job.jevAssessment?.assessedAt;
  return { ...jobSummary(job), jobDescription: job.jobDescription || "", notes: job.notes || "",
    instructions: job.instructions || "", questions: job.questions || [],
    overviewSummary: current ? { position: summary.position, fit: summary.fit,
      fingerprint: summary.fingerprint, assessedAt: summary.assessedAt } : null };
}

export function haystack(j) {
  return [j.company, j.role, j.source, j.location, j.locationMode, j.salary, j.notes,
    j.rationale, j.jobDescription, j.tier, j.stage, j.recruiter?.name, j.recruiter?.org]
    .filter(Boolean).join(" ").toLowerCase();
}

export function searchTerms(q) {
  return [...String(q || "").toLowerCase().matchAll(/"([^"]*)"|(\S+)/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]).trim()).filter(Boolean);
}

export function matchesSearch(job, query) {
  const text = haystack(job);
  return searchTerms(query).every(term => text.includes(term));
}
