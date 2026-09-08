// Explicit HTTP projections. New stored fields are private until selected here.
const SUMMARY_FIELDS = ["id", "revision", "company", "role", "source", "sourceType", "sourceUrl", "threadId",
  "location", "locationMode", "salary", "score", "tier", "scoreBreakdown", "rationale", "replyOwed",
  "userViewed", "closed", "archived", "archivedAt", "stage", "fitReportId", "receivedAt", "createdAt", "updatedAt",
  "coverLetterAt", "coverLetterModel", "coverLetterWords", "coverRun"];

export function jobSummary(job) {
  const out = Object.fromEntries(SUMMARY_FIELDS.filter(k => job[k] !== undefined).map(k => [k, job[k]]));
  out.recruiter = job.recruiter ? {
    name: job.recruiter.name || "", org: job.recruiter.org || "", daysWaiting: job.recruiter.daysWaiting ?? null,
  } : null;
  out.hasDescription = !!job.jobDescription;
  out.hasInstructions = !!job.instructions;
  out.hasNotes = !!job.notes;
  out.hasCoverLetter = !!job.coverLetter;
  out.letterVersionCount = (job.coverLetterVersions || []).length;
  out.questionCount = (job.questions || []).length;
  out.answeredCount = (job.questions || []).filter(q => q.a || q.refused).length;
  return out;
}

export function jobDetail(job) {
  return { ...jobSummary(job), jobDescription: job.jobDescription || "", notes: job.notes || "",
    instructions: job.instructions || "", questions: job.questions || [] };
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
