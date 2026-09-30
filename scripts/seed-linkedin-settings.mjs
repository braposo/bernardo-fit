import { createStorageClient } from '../lib/sanity/client.js';
import { ANALYSIS_SETTINGS_ID } from '../lib/sanity/analysis-settings.js';
import { DEFAULT_LINKEDIN_SETTINGS, validateLinkedInSettings } from '../lib/sanity/linkedin-settings.js';

// Add only missing configuration; preserve existing published values and unrelated draft edits.
const client = createStorageClient().withConfig({ perspective: 'raw' });
const ids = [ANALYSIS_SETTINGS_ID, `drafts.${ANALYSIS_SETTINGS_ID}`];
const documents = await client.fetch('*[_id in $ids]{_id,_rev,linkedinScreening}', { ids });
const published = documents.find(doc => doc._id === ANALYSIS_SETTINGS_ID);
if (!published) throw new Error('Published Analysis settings not found.');
const seed = validateLinkedInSettings(published.linkedinScreening ?? DEFAULT_LINKEDIN_SETTINGS);
const missing = documents.filter(doc => doc.linkedinScreening == null);
if (!process.argv.includes('--apply')) console.log(`${missing.length} document(s) need LinkedIn settings. Use --apply to save.`);
else if (missing.length) {
  let transaction = client.transaction();
  for (const doc of missing) transaction = transaction.patch(doc._id, patch =>
    patch.ifRevisionId(doc._rev).setIfMissing({ linkedinScreening: seed }));
  await transaction.commit();
  console.log(`Added LinkedIn settings to ${missing.length} document(s); existing edits preserved.`);
} else console.log('LinkedIn settings already exist; no changes made.');
