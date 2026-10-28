import { createStorageClient } from "../lib/sanity/client.js";
import { ANALYSIS_SETTINGS_ID } from "../lib/sanity/analysis-settings.js";
import { DEFAULT_REVIEW_AGENT } from "../lib/sanity/review-agent-settings.js";

// Adds the default review agent settings (disabled) where they are missing.
// Published edits and unpublished drafts that already carry them are left alone.
// node --env-file=.env.local scripts/seed-review-agent.mjs [--apply]
const client = createStorageClient().withConfig({perspective: "raw"});
const ids = [ANALYSIS_SETTINGS_ID, `drafts.${ANALYSIS_SETTINGS_ID}`];
const documents = await client.fetch('*[_id in $ids]{_id, _rev, reviewAgent}', {ids});
if (!documents.some(doc => doc._id === ANALYSIS_SETTINGS_ID)) throw Error("Published Analysis settings not found.");
const missing = documents.filter(doc => doc.reviewAgent == null);
if (!process.argv.includes("--apply")) {
  console.log(`${missing.length} settings document(s) would get the default review agent settings. Use --apply to save.`);
} else if (missing.length) {
  let transaction = client.transaction();
  for (const doc of missing) transaction = transaction.patch(doc._id, patch => patch.ifRevisionId(doc._rev)
    .setIfMissing({reviewAgent: structuredClone(DEFAULT_REVIEW_AGENT)}));
  await transaction.commit();
  console.log(`Added default review agent settings to ${missing.length} settings document(s).`);
} else {
  console.log("Review agent settings are already published.");
}
