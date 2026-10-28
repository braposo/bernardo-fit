import { createStorageClient } from "../lib/sanity/client.js";
import { ANALYSIS_SETTINGS_ID } from "../lib/sanity/analysis-settings.js";
import { DEFAULT_JSEARCH_SETTINGS } from "../lib/sanity/jsearch-settings.js";

// Adds disabled JSearch discovery settings where they are missing. Published edits
// and unpublished drafts that already carry them are left alone.
// node --env-file=.env.local scripts/seed-jsearch-discovery.mjs [--apply]
const client = createStorageClient().withConfig({perspective: "raw"});
const ids = [ANALYSIS_SETTINGS_ID, `drafts.${ANALYSIS_SETTINGS_ID}`];
const documents = await client.fetch('*[_id in $ids]{_id, _rev, jsearchDiscovery}', {ids});
if (!documents.some(doc => doc._id === ANALYSIS_SETTINGS_ID)) throw Error("Published Analysis settings not found.");
const missing = documents.filter(doc => doc.jsearchDiscovery == null);
if (!process.argv.includes("--apply")) {
  console.log(`${missing.length} settings document(s) would get JSearch discovery (disabled). Use --apply to save.`);
} else if (missing.length) {
  let transaction = client.transaction();
  for (const doc of missing) transaction = transaction.patch(doc._id, patch => patch.ifRevisionId(doc._rev)
    .setIfMissing({jsearchDiscovery: structuredClone(DEFAULT_JSEARCH_SETTINGS)}));
  await transaction.commit();
  console.log(`Added disabled JSearch discovery to ${missing.length} settings document(s).`);
} else {
  console.log("JSearch discovery settings are already published.");
}
