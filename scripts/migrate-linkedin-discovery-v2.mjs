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
if (!fields) console.log('Published LinkedIn discovery already uses policy v2; no changes made.');
else if (!apply) console.log('Published v1 settings need v2 migration. Dry run only; pass --apply --worker-compatible after worker verification.');
else {
  await client.patch(document._id).ifRevisionId(document._rev).set(fields).commit();
  console.log('Published LinkedIn discovery policy v2 with enabled=false. Review the disabled run before enabling in Studio.');
}
