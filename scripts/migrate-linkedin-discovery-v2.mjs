import { createStorageClient } from '../lib/sanity/client.js';
import { ANALYSIS_SETTINGS_ID } from '../lib/sanity/analysis-settings.js';
import { linkedinV2MigrationFields } from '../lib/sanity/linkedin-migration.js';

const apply = process.argv.includes('--apply');
if (apply && !process.argv.includes('--worker-compatible'))
  throw new Error('Deploy and verify the v2-compatible production worker first; then pass --apply --worker-compatible. The old worker ignores the v2 disabled switch.');

const client = createStorageClient().withConfig({ perspective: 'raw' });
// Fetch only the published singleton. A draft may contain unrelated editorial work.
const document = await client.fetch('*[_id == $id][0]{_id,_rev,linkedinScreening}', { id: ANALYSIS_SETTINGS_ID });
const fields = linkedinV2MigrationFields(document);
if (!fields) console.log('Published LinkedIn settings already include bounded daily results; no changes made.');
else if (!apply) console.log('Published LinkedIn settings need the bounded maxSearchResults field. Dry run only; apply after the compatible worker is deployed.');
else {
  if (document.linkedinScreening?.policyVersion === 2 && document.linkedinScreening?.enabled !== false)
    throw new Error('Pause published LinkedIn discovery before adding maxSearchResults.');
  await client.patch(document._id).ifRevisionId(document._rev).set(fields).commit();
  console.log('Published maxSearchResults under a revision guard; existing policy and disabled state were preserved.');
}
