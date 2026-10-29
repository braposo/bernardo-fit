import { createStorageClient } from "../lib/sanity/client.js";
import { ANALYSIS_SETTINGS_ID } from "../lib/sanity/analysis-settings.js";
import { DEFAULT_EMAIL_STATUS } from "../lib/sanity/email-status-settings.js";

// Adds the default email status proposal settings (disabled) where they are missing.
// Published edits and unpublished drafts that already carry them are left alone.
// node --env-file=.env.local scripts/seed-email-status-proposals.mjs [--apply]
const client = createStorageClient().withConfig({perspective: "raw"});
const ids = [ANALYSIS_SETTINGS_ID, `drafts.${ANALYSIS_SETTINGS_ID}`];
const documents = await client.fetch('*[_id in $ids]{_id, _rev, emailStatusProposals}', {ids});
if (!documents.some(doc => doc._id === ANALYSIS_SETTINGS_ID)) throw Error("Published Analysis settings not found.");
const missing = documents.filter(doc => doc.emailStatusProposals == null);
if (!process.argv.includes("--apply")) {
  console.log(`${missing.length} settings document(s) would get the default email status proposal settings. Use --apply to save.`);
} else if (missing.length) {
  let transaction = client.transaction();
  for (const doc of missing) transaction = transaction.patch(doc._id, patch => patch.ifRevisionId(doc._rev)
    .setIfMissing({emailStatusProposals: structuredClone(DEFAULT_EMAIL_STATUS)}));
  await transaction.commit();
  console.log(`Added default email status proposal settings to ${missing.length} settings document(s).`);
} else {
  console.log("Email status proposal settings are already published.");
}
