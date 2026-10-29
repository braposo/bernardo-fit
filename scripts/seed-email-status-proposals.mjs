import { createStorageClient } from "../lib/sanity/client.js";
import { ANALYSIS_SETTINGS_ID } from "../lib/sanity/analysis-settings.js";
import { DEFAULT_EMAIL_STATUS, DEFAULT_GMAIL_CHECK } from "../lib/sanity/email-status-settings.js";

// Adds the default email status proposal settings (disabled) where they are
// missing, and the Gmail check defaults (disabled) where only those are missing.
// Published edits and unpublished drafts that already carry them are left alone.
// node --env-file=.env.local scripts/seed-email-status-proposals.mjs [--apply]
const client = createStorageClient().withConfig({perspective: "raw"});
const ids = [ANALYSIS_SETTINGS_ID, `drafts.${ANALYSIS_SETTINGS_ID}`];
const documents = await client.fetch('*[_id in $ids]{_id, _rev, emailStatusProposals}', {ids});
if (!documents.some(doc => doc._id === ANALYSIS_SETTINGS_ID)) throw Error("Published Analysis settings not found.");
const missing = documents.filter(doc => doc.emailStatusProposals == null);
const missingGmail = documents.filter(doc => doc.emailStatusProposals != null && doc.emailStatusProposals.gmailCheck == null);
if (!process.argv.includes("--apply")) {
  console.log(`${missing.length} settings document(s) would get the default email status proposal settings and ${missingGmail.length} the default Gmail check settings. Use --apply to save.`);
} else if (missing.length || missingGmail.length) {
  let transaction = client.transaction();
  for (const doc of missing) transaction = transaction.patch(doc._id, patch => patch.ifRevisionId(doc._rev)
    .setIfMissing({emailStatusProposals: structuredClone(DEFAULT_EMAIL_STATUS)}));
  for (const doc of missingGmail) transaction = transaction.patch(doc._id, patch => patch.ifRevisionId(doc._rev)
    .setIfMissing({"emailStatusProposals.gmailCheck": structuredClone(DEFAULT_GMAIL_CHECK)}));
  await transaction.commit();
  console.log(`Added default email status proposal settings to ${missing.length} and Gmail check settings to ${missingGmail.length} settings document(s).`);
} else {
  console.log("Email status proposal and Gmail check settings are already published.");
}
