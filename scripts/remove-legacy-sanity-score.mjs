import {mkdir, writeFile} from 'node:fs/promises';
import {createStorageClient} from '../lib/sanity/client.js';

// Dry run by default. Only job.score is removed; fitAssessment.score is untouched.
const client = createStorageClient().withConfig({perspective: 'raw'});
const jobs = await client.fetch('*[_type == "job" && defined(score)]{_id,_rev,score,activeAssessment}');
console.log(`Found ${jobs.length} job documents with a legacy score (including drafts).`);
if (process.argv.includes('--apply') && jobs.length) {
  const directory = new URL('../migration/reports/', import.meta.url);
  await mkdir(directory, {recursive: true});
  const backup = new URL(`legacy-job-scores-${Date.now()}.json`, directory);
  await writeFile(backup, JSON.stringify(jobs, null, 2));
  console.log(`Recovery copy: ${backup.pathname}`);
  for (let offset = 0; offset < jobs.length; offset += 100) {
    let transaction = client.transaction();
    for (const job of jobs.slice(offset, offset + 100)) {
      transaction = transaction.patch(job._id, patch => patch.ifRevisionId(job._rev).unset(['score']));
    }
    await transaction.commit({visibility: 'sync'});
  }
  const remaining = await client.fetch('count(*[_type == "job" && defined(score)])');
  if (remaining) throw new Error(`${remaining} legacy scores remain; rerun after stopping legacy writers.`);
  console.log('Verified: no job documents have a legacy score.');
}
