import { createStorageClient } from "../lib/sanity/client.js";
import { ANALYSIS_SETTINGS_ID } from "../lib/sanity/analysis-settings.js";

// Change this field only; preserve published prompts and unpublished draft edits.
const client = createStorageClient().withConfig({perspective: "raw"});
const ids = [ANALYSIS_SETTINGS_ID, `drafts.${ANALYSIS_SETTINGS_ID}`];
const documents = await client.fetch('*[_id in $ids]{_id, _rev, ingestMinimumScore}', {ids});
if (!documents.some(doc => doc._id === ANALYSIS_SETTINGS_ID)) throw Error("Published Analysis settings not found.");
const changed = documents.filter(doc => doc.ingestMinimumScore !== 50);
if (!process.argv.includes("--apply")) {
  console.log(`${changed.length} settings document(s) would receive minimum job admission score 50. Use --apply to save.`);
} else if (changed.length) {
  let transaction = client.transaction();
  for (const doc of changed) transaction = transaction.patch(doc._id, patch => patch.ifRevisionId(doc._rev).set({ingestMinimumScore: 50}));
  await transaction.commit();
  console.log(`Set minimum job admission score to 50 on ${changed.length} settings document(s).`);
} else {
  console.log("Minimum job admission score is already 50.");
}
