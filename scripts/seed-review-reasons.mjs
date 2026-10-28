import { createStorageClient } from "../lib/sanity/client.js";
import { ANALYSIS_SETTINGS_ID } from "../lib/sanity/analysis-settings.js";
import { DEFAULT_REVIEW_REASONS } from "../lib/sanity/review-reasons.js";

// Adds the default review quick-pick reasons where they are missing. Published
// edits and unpublished drafts that already carry them are left alone.
// node --env-file=.env.local scripts/seed-review-reasons.mjs [--apply]
const client = createStorageClient().withConfig({perspective: "raw"});
const ids = [ANALYSIS_SETTINGS_ID, `drafts.${ANALYSIS_SETTINGS_ID}`];
const documents = await client.fetch('*[_id in $ids]{_id, _rev, reviewReasons}', {ids});
if (!documents.some(doc => doc._id === ANALYSIS_SETTINGS_ID)) throw Error("Published Analysis settings not found.");
const missing = documents.filter(doc => doc.reviewReasons == null);
if (!process.argv.includes("--apply")) {
  console.log(`${missing.length} settings document(s) would get the default review reasons. Use --apply to save.`);
} else if (missing.length) {
  let transaction = client.transaction();
  for (const doc of missing) transaction = transaction.patch(doc._id, patch => patch.ifRevisionId(doc._rev)
    .setIfMissing({reviewReasons: structuredClone(DEFAULT_REVIEW_REASONS)}));
  await transaction.commit();
  console.log(`Added default review reasons to ${missing.length} settings document(s).`);
} else {
  console.log("Review reasons are already published.");
}
