// Completes a role moved out of Filtered so it matches roles the screens
// admitted: the LinkedIn description when only the card was saved, then the
// full Jev assessment and overview summary. Progress lives on the job's
// `jevRun` pointer, so the pipeline shows it like any other fit assessment.
import { randomUUID } from "node:crypto";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { deleteJob, getJob, linkedinPostingId, listJobs, mutateJob } from "./store.js";
import { checkRepeat, recordJobRepost, repostEntry } from "./job-duplicates.js";
import { scoringFingerprint } from "./jev-scoring.js";
import { executeJevWork } from "./jev-work.js";
import { JEV_MODEL, jevEnabled } from "./jev.js";
import { saveRunReceipt } from "./run-receipts.js";
import { assertStorageDispatch, FILTERED_ENRICH_TASK_ID } from "./task-policy.js";

export const FILTERED_ENRICH_KIND = "filtered-enrich";
// Roles added from a pasted LinkedIn link (lib/linkedin-link.js). They start
// with only the posting link, so the fetched title, company and location
// replace the placeholders, and the opening is checked against the pipeline.
export const LINK_SOURCE = "LinkedIn link";
const ACTIVE = ["dispatching", "queued"];
const stop = message => Object.assign(new Error(message), { abort: true });
const hasText = value => !!String(value || "").trim();

export function needsCompletion(job) {
  return !!job && !job.archived && !(hasText(job.jobDescription) && job.jevAssessment && job.overviewSummary);
}

async function defaultTrigger(jobId, requestId) {
  const key = await idempotencyKeys.create(`${FILTERED_ENRICH_TASK_ID}:${jobId}:${requestId}`, { scope: "global" });
  return tasks.trigger(FILTERED_ENRICH_TASK_ID, { jobId, requestId },
    { idempotencyKey: key, idempotencyKeyTTL: "30d", tags: [`job:${jobId}`, `request:${requestId}`] });
}

// Called by the admin API right after a move. Returns the job with its run
// pointer, or the job unchanged when there is nothing to do or Jev is off.
export async function startMovedJobCompletion(job, { trigger = defaultTrigger, now = new Date() } = {}) {
  if (!jevEnabled() || !needsCompletion(job) || ACTIVE.includes(job.jevRun?.status)) return job;
  assertStorageDispatch();
  const requestId = `moved-${randomUUID()}`;
  let claimed = false;
  await mutateJob(job.id, current => {
    if (ACTIVE.includes(current.jevRun?.status)) return undefined;
    claimed = true;
    return { jevRun: { requestId, runId: "", model: JEV_MODEL, fingerprint: "", status: "dispatching",
      startedAt: now.toISOString(), finishedAt: "" } };
  });
  if (!claimed) return getJob(job.id);
  try {
    const handle = await trigger(job.id, requestId);
    await saveRunReceipt({ kind: FILTERED_ENRICH_KIND, requestId, runId: handle.id, jobId: job.id, fingerprint: "" });
    await mutateJob(job.id, current => current.jevRun?.requestId === requestId && current.jevRun.status === "dispatching"
      ? { jevRun: { ...current.jevRun, runId: handle.id, status: "queued" } } : undefined);
  } catch (error) {
    await mutateJob(job.id, current => current.jevRun?.requestId === requestId && !current.jevRun.runId
      ? { jevRun: { ...current.jevRun, status: "failed", finishedAt: new Date().toISOString() } } : undefined);
    throw error;
  }
  return getJob(job.id);
}

// Worker side. `fetchDescription` receives a LinkedIn card and returns the
// opportunity `linkedinOpportunity` builds from the public posting.
// The repost check for link-added roles, replaceable in tests. Only roles in
// the pipeline or archive count: a Filtered match is one he now wants to see.
export const linkRepeats = {
  list: () => listJobs({ includeArchived: true }),
  check: (posting, records) => checkRepeat(posting, records),
  record: (match, entry) => recordJobRepost(match.repeat.id, entry),
  remove: id => deleteJob(id),
};

async function findLinkRepeat(job, repeats) {
  const records = (await repeats.list()).filter(other => other.id !== job.id).map(other => ({ ...other, kind: "job" }));
  if (!records.length) return null;
  try { return await repeats.check(job, records); }
  catch (error) {
    if (error.fatal) throw error;
    // An unavailable check never blocks a role he asked for.
    console.warn(`Repost check skipped for ${job.id}: ${error.message}`);
    return null;
  }
}

export async function completeMovedJob({ jobId, requestId }, { fetchDescription, assess = executeJevWork, progress = (_phase) => {}, repeats = linkRepeats }) {
  let job = await getJob(jobId);
  if (!job) throw stop("This role no longer exists.");
  if (job.jevRun?.requestId !== requestId) return { outcome: "superseded", jobId, requestId };
  if (!hasText(job.jobDescription)) {
    const id = linkedinPostingId(job);
    if (!id) throw stop("This role has no saved description or LinkedIn posting to fetch one from. Add the description in Role details, then assess fit.");
    progress("fetching");
    const placeholder = job.source === LINK_SOURCE;
    const details = await fetchDescription({ id, company: placeholder ? "" : job.company, role: placeholder ? "" : job.role,
      location: placeholder ? "" : job.location,
      sourceUrl: job.sourceUrl || `https://www.linkedin.com/jobs/view/${id}` });
    if (!hasText(details?.jobDescription)) throw stop("LinkedIn did not return a description for this posting.");
    // Never replace a description added by hand while the fetch was running.
    await mutateJob(jobId, current => hasText(current.jobDescription) ? undefined : {
      jobDescription: details.jobDescription,
      ...(current.source === LINK_SOURCE ? {
        ...(hasText(details.company) ? { company: details.company } : {}),
        ...(hasText(details.role) ? { role: details.role } : {}),
        ...(hasText(details.location) ? { location: details.location } : {}),
      } : {}),
      ...(!current.notes && details.notes ? { notes: details.notes } : {}),
      ...(!current.location && details.location ? { location: details.location } : {}),
      ...(!current.sourceType && details.sourceType ? { sourceType: details.sourceType } : {}),
    });
    job = await getJob(jobId);
    if (job?.source === LINK_SOURCE) {
      progress("checking");
      const match = await findLinkRepeat(job, repeats);
      if (match) {
        // The same opening is already a role: note this listing on it and
        // drop the copy, so it is never assessed twice.
        await repeats.record(match, repostEntry(job, match));
        await repeats.remove(jobId);
        return { outcome: "duplicate", jobId, requestId, repeatOf: match.repeat.id,
          company: match.repeat.company || "", role: match.repeat.role || "", archived: !!match.repeat.archived };
      }
    }
  }
  const fingerprint = scoringFingerprint(job);
  let owned = false;
  await mutateJob(jobId, current => {
    if (current.jevRun?.requestId !== requestId) return undefined;
    owned = true;
    return { jevRun: { ...current.jevRun, fingerprint } };
  });
  if (!owned) return { outcome: "superseded", jobId, requestId };
  progress("scoring");
  return assess({ jobId, requestId, fingerprint });
}
