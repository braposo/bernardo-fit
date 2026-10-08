import { createStorageClient } from "../lib/sanity/client.js";
import { ANALYSIS_SETTINGS_ID } from "../lib/sanity/analysis-settings.js";
import { DEFAULT_SETTINGS } from "../lib/sanity/analysis-defaults.js";

// Adds the filtered-job retention period where it is missing. Published edits
// and unpublished drafts that already carry a value are left alone.
// node --env-file=.env.local scripts/seed-filtered-job-retention.mjs [--apply]
const days = DEFAULT_SETTINGS.filteredJobRetentionDays;
const client = createStorageClient().withConfig({perspective: "raw"});
const ids = [ANALYSIS_SETTINGS_ID, `drafts.${ANALYSIS_SETTINGS_ID}`];
const documents = await client.fetch('*[_id in $ids]{_id, _rev, filteredJobRetentionDays}', {ids});
if (!documents.some(doc => doc._id === ANALYSIS_SETTINGS_ID)) throw Error("Published Analysis settings not found.");
const missing = documents.filter(doc => doc.filteredJobRetentionDays == null);
if (!process.argv.includes("--apply")) {
  console.log(`${missing.length} settings document(s) would keep filtered jobs for ${days} days. Use --apply to save.`);
} else if (missing.length) {
  let transaction = client.transaction();
  for (const doc of missing) transaction = transaction.patch(doc._id, patch => patch.ifRevisionId(doc._rev).setIfMissing({filteredJobRetentionDays: days}));
  await transaction.commit();
  console.log(`Set filtered job retention to ${days} days on ${missing.length} settings document(s).`);
} else {
  console.log("Filtered job retention is already published.");
}
