// Backfill: asks the review agent for a suggestion on every job at New that has
// a saved assessment and no suggestion yet. Dry run by default.
//
//   node --env-file=.env.local scripts/review-new-jobs.mjs                     # lists them
//   node --env-file=.env.local scripts/review-new-jobs.mjs --apply             # triggers review-job for each
//   node --env-file=.env.local scripts/review-new-jobs.mjs --refresh [--apply] # also reviews written under an older policy
//
// Each trigger uses the same per-job, per-assessment, per-policy idempotency key
// as the automatic hook, so running it twice does not review a job twice. The review
// agent must be published and enabled in Analysis settings first.
import { listJobs } from "../lib/store.js";
import { withAnalysisSettings, reviewAgentSettings } from "../lib/sanity/analysis-settings.js";
import { jobsToReview, requestJobReview, REVIEW_POLICY } from "../lib/review-agent.js";

const apply = process.argv.includes("--apply");
const refresh = process.argv.includes("--refresh");
await withAnalysisSettings(async () => {
  const settings = reviewAgentSettings();
  const jobs = jobsToReview(await listJobs(), { refresh });
  // Metadata only: no descriptions, assessments or candidate content in logs.
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", refresh, policy: REVIEW_POLICY, enabled: !!settings?.enabled, jobs: jobs.length,
    ids: jobs.map(job => job.id) }, null, 2));
  if (!apply) { console.log("No reviews requested. Use --apply to trigger them."); return; }
  if (!settings?.enabled) throw Error("Publish the review agent with enabled: true before the backfill.");
  if (!process.env.TRIGGER_SECRET_KEY) throw Error("Set TRIGGER_SECRET_KEY for the Trigger environment that should run the reviews.");
  let requested = 0;
  for (const job of jobs) {
    const result = await requestJobReview(job);
    if (result.requested) requested++;
    else console.warn(`Not requested for ${job.id}${result.error ? `: ${result.error}` : ""}`);
  }
  console.log(`Requested ${requested} of ${jobs.length} review(s).`);
  if (requested < jobs.length) process.exitCode = 1;
});
