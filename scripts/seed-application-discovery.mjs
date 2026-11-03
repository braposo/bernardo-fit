import { createStorageClient } from '../lib/sanity/client.js';
import { ANALYSIS_SETTINGS_ID } from '../lib/sanity/analysis-settings.js';
import { DEFAULT_POSTING_CHECK } from '../lib/sanity/posting-check-settings.js';

const client = createStorageClient().withConfig({ perspective: 'raw' });
const doc = await client.fetch('*[_id == $id][0]{_id,_rev,postingCheck}', { id: ANALYSIS_SETTINGS_ID });
if (!doc?.postingCheck) throw new Error('Publish posting check settings first.');
const patch = Object.fromEntries(['discoveryPrompt', 'discoveryModel', 'maxDiscoverySearches']
  .filter(key => doc.postingCheck[key] == null).map(key => [`postingCheck.${key}`, DEFAULT_POSTING_CHECK[key]]));
if (!Object.keys(patch).length) console.log('Application discovery settings already exist.');
else if (!process.argv.includes('--apply')) console.log('Would add missing application discovery settings. Use --apply to save.');
else {
  await client.patch(doc._id).ifRevisionId(doc._rev).setIfMissing(patch).commit();
  console.log('Added missing published application discovery settings; drafts and existing edits were preserved.');
}
