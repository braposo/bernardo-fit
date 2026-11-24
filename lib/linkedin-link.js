// Adds a role from a LinkedIn job link pasted (or sent) into the admin. The
// role is saved at New straight away with only its posting link; the Filtered
// completion task then fetches the public posting (title, company, location,
// description), checks it is not an opening already in the pipeline, and runs
// the full fit assessment and Overview summary. No admission threshold applies:
// a role added by hand is one Bernardo wants to see.
import { createJobIfAbsent, findExistingJobIn, listJobs } from "./store.js";
import { ingestIdentity } from "./ingest-work.js";
import { LINK_SOURCE, startMovedJobCompletion } from "./filtered-job-enrich.js";
import { linkedInJobId, linkedInJobUrl } from "../public/linkedin-job-link.js";

export { LINK_SOURCE, linkedInJobId, linkedInJobUrl };

// Returns { existing } when the posting is already a role (active or archived),
// otherwise { job } for the new role, with its background run pointer when the
// completion started, and { completionError } when it could not.
export async function addLinkedInJob(input, { start = startMovedJobCompletion, now = new Date() } = {}) {
  const id = linkedInJobId(input);
  if (!id) throw Object.assign(new Error("That isn't a LinkedIn job link. Copy the link from the job post and try again."), { status: 400 });
  const sourceUrl = linkedInJobUrl(id);
  const posting = { externalId: `linkedin-${id}`, sourceUrl };
  const existing = findExistingJobIn(await listJobs({ includeArchived: true }), posting);
  if (existing) return { existing };
  const job = await createJobIfAbsent(ingestIdentity(posting), {
    ...posting, company: "LinkedIn", role: `Job ${id}`, source: LINK_SOURCE, sourceType: "job-board",
    stage: "new", receivedAt: now.toISOString(),
    notes: "Added from a LinkedIn link. Working arrangements and salary are only as stated in the original description.",
  });
  try { return { job: await start(job) || job, created: true }; }
  catch (error) { return { job, created: true, completionError: error.message || "Could not start fetching the job details." }; }
}
