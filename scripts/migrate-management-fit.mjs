import { createContentClient, createStorageClient } from '../lib/sanity/client.js';
import { managementFitMigrationPlan, applyManagementFitMigration } from '../lib/sanity/management-fit-migration.js';

// Run with the existing environment loader, e.g. node --env-file=.env.local.
// Deploy the scoring-cap changes to app and worker before applying published settings.
const apply = process.argv.includes('--apply');
if (apply && !process.argv.includes('--worker-compatible'))
  throw new Error('Deploy compatible app and worker first; then pass --apply --worker-compatible.');
const client = (apply ? createStorageClient() : createContentClient()).withConfig({ perspective: 'raw' });
const documents = await client.fetch(`*[_id in ["fit-analysis-settings", "drafts.fit-analysis-settings"] ||
  (_type == "candidateProfile" && migration.sourceKey == "candidate:bernardo")]{...}`);
const candidates = documents.filter(doc => doc._type === 'candidateProfile' && !doc._id.startsWith('drafts.') && !doc._id.startsWith('versions.'));
if (candidates.length !== 1) throw new Error('Expected exactly one published Bernardo candidate profile.');
const plan = managementFitMigrationPlan(documents.find(doc => doc._id === 'fit-analysis-settings'), candidates[0]);
// Metadata only: do not expose candidate content, tokens or prompt text in CLI logs.
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', changes: plan.map(({ id, fields }) => ({ id, fields: Object.keys(fields) })),
  untouchedDrafts: documents.filter(doc => doc._id.startsWith('drafts.')).length }, null, 2));
if (apply) {
  await applyManagementFitMigration(client, plan);
  console.log(`Updated ${plan.length} published document(s); drafts and unrelated fields preserved.`);
} else console.log('No changes made. Use --apply --worker-compatible after deploying compatible app and worker.');
