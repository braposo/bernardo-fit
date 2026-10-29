import { createStorageClient } from "../lib/sanity/client.js";
import { ANALYSIS_SETTINGS_ID } from "../lib/sanity/analysis-settings.js";
import { DEFAULT_REVIEW_AGENT } from "../lib/sanity/review-agent-settings.js";

// Adds the default review agent settings (disabled) where they are missing, and
// any field added since (the automatic-move gates and learnPreferences, which is
// seeded off) to settings that already exist. Published edits and unpublished
// drafts that already carry a value are left alone; autoAdvance, autoDrop and
// learnPreferences are never switched on.
// node --env-file=.env.local scripts/seed-review-agent.mjs [--apply]
const client = createStorageClient().withConfig({perspective: "raw"});
const ids = [ANALYSIS_SETTINGS_ID, `drafts.${ANALYSIS_SETTINGS_ID}`];
const documents = await client.fetch('*[_id in $ids]{_id, _rev, reviewAgent}', {ids});
if (!documents.some(doc => doc._id === ANALYSIS_SETTINGS_ID)) throw Error("Published Analysis settings not found.");
// Each document's missing defaults: the whole object, or the fields it lacks.
const changes = documents.map(doc => doc.reviewAgent == null ? {doc, whole: true, fields: Object.keys(DEFAULT_REVIEW_AGENT)}
  : {doc, whole: false, fields: Object.keys(DEFAULT_REVIEW_AGENT).filter(key => doc.reviewAgent[key] == null)})
  .filter(change => change.fields.length);
if (!process.argv.includes("--apply")) {
  if (!changes.length) console.log("Review agent settings are already complete.");
  for (const {doc, whole, fields} of changes) console.log(`${doc._id} would get ${whole ? "the default review agent settings" : `reviewAgent.${fields.join(", reviewAgent.")}`}.`);
  if (changes.length) console.log("Use --apply to save.");
} else if (changes.length) {
  let transaction = client.transaction();
  for (const {doc, whole, fields} of changes) transaction = transaction.patch(doc._id, patch => patch.ifRevisionId(doc._rev)
    .setIfMissing(whole ? {reviewAgent: structuredClone(DEFAULT_REVIEW_AGENT)}
      : Object.fromEntries(fields.map(key => [`reviewAgent.${key}`, DEFAULT_REVIEW_AGENT[key]]))));
  await transaction.commit();
  console.log(`Added missing review agent settings to ${changes.length} settings document(s).`);
} else {
  console.log("Review agent settings are already complete.");
}
