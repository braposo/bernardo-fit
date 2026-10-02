import { createStorageClient } from '../lib/sanity/client.js';
import { ANALYSIS_SETTINGS_ID } from '../lib/sanity/analysis-settings.js';
import { DEFAULT_LINKEDIN_SETTINGS, validateLinkedInSettings } from '../lib/sanity/linkedin-settings.js';

// Add native options without overwriting editorial policy or publishing unrelated drafts.
// A missing document receives disabled v2 defaults, which the old worker cannot interpret.
if (process.argv.includes('--apply') && !process.argv.includes('--worker-compatible'))
  throw new Error('Deploy the v2-compatible worker before seeding; pass --apply --worker-compatible.');
const client = createStorageClient().withConfig({ perspective: 'raw' });
const ids = [ANALYSIS_SETTINGS_ID, `drafts.${ANALYSIS_SETTINGS_ID}`];
const documents = await client.fetch('*[_id in $ids]{_id,_rev,linkedinScreening}', { ids });
if (!documents.some(doc => doc._id === ANALYSIS_SETTINGS_ID)) throw new Error('Published Analysis settings not found.');
const changes = documents.map(doc => {
  const current = doc.linkedinScreening;
  if (current == null) return {doc,fields:{linkedinScreening:DEFAULT_LINKEDIN_SETTINGS}};
  const fields = {};
  if (!current.retry) {
    const legacy = current.retryMinutes;
    fields['linkedinScreening.retry'] = Array.isArray(legacy) ? {
      maxAttempts: legacy.length + 1, minTimeoutInMs: (legacy[0] || 5) * 60_000,
      maxTimeoutInMs: (legacy.at(-1) || 30) * 60_000,
      factor: legacy.length > 1 ? legacy[1] / legacy[0] : 1, randomize: true,
    } : DEFAULT_LINKEDIN_SETTINGS.retry;
  }
  if (current.requestTimeoutSeconds == null) fields['linkedinScreening.requestTimeoutSeconds'] = DEFAULT_LINKEDIN_SETTINGS.requestTimeoutSeconds;
  validateLinkedInSettings({...current,retry:current.retry || fields['linkedinScreening.retry'],
    requestTimeoutSeconds:current.requestTimeoutSeconds ?? fields['linkedinScreening.requestTimeoutSeconds']});
  return {doc,fields};
}).filter(change => Object.keys(change.fields).length);
if (!process.argv.includes('--apply')) console.log(`${changes.length} document(s) need native Trigger request options. Use --apply to save.`);
else if (changes.length) {
  let transaction = client.transaction();
  for (const {doc,fields} of changes) transaction = transaction.patch(doc._id, patch => patch.ifRevisionId(doc._rev).setIfMissing(fields));
  await transaction.commit();
  console.log(`Added native Trigger options to ${changes.length} document(s); existing values preserved.`);
} else console.log('Native Trigger request options already exist; no changes made.');
