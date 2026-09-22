// Repair older exports that omitted dismissal state. Never infer dismissal from
// an orphan alone: require a complete source inventory and zero adoptable reports.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createStorageClient} from '../../lib/sanity/client.js';
import {listJobs,findUnlinkedReportIds} from '../../lib/store.js';
assert.equal(process.env.SANITY_CONTENT_ENABLED,'1');
const read=async path=>{
  const response=await fetch(`https://fit.bernardoraposo.com${path}`,{headers:{'x-admin-secret':process.env.ADMIN_SECRET},redirect:'error'});
  assert.ok(response.ok,`Source request failed: ${response.status}`);return response.json();
};
const [active,archive,reports]=await Promise.all([
  read('/api/admin/jobs'),read('/api/admin/jobs?archived=1'),read('/api/admin/reports?limit=100'),
]);
assert.equal(active.unlinked,0,'Source still has adoptable reports; use an explicit dismissal export instead');
assert.equal(archive.unlinked,0);
assert.equal(reports.reports.length,reports.total,'Source report inventory must be complete');
assert.equal(archive.jobs.length,active.archivedCount);
const linked=new Set([...active.jobs,...archive.jobs].map(job=>job.fitReportId).filter(Boolean));
const dismissed=reports.reports.map(report=>report.id).filter(id=>!linked.has(id)).sort();
const client=createStorageClient();
const branchJobs=await listJobs({includeArchived:true});
const branchOrphans=(await findUnlinkedReportIds(branchJobs)).sort();
// A repeat after successful repair is a no-op, provided all verified records remain dismissed.
const docs=await client.fetch('*[_type == "fitReport" && legacyId in $ids && (current == true || migration.sourceKey == "report:" + legacyId + ":current")]',{ids:dismissed});
assert.equal(docs.length,dismissed.length);
assert.deepEqual(branchOrphans,docs.filter(d=>!d.dismissed).map(d=>d.legacyId).sort(),'Source and destination orphans differ; do not guess');
assert.equal(await client.withConfig({perspective:'raw'}).fetch('count(*[_id in $ids])',{ids:docs.map(d=>`drafts.${d._id}`)}),0,'Publish or discard pending drafts first');
const pending=docs.filter(d=>!d.dismissed);
console.log(JSON.stringify({verifiedDismissedReports:docs.length,toRestore:pending.length,apply:process.argv.includes('--apply')}));
if(process.argv.includes('--apply') && pending.length){
  await mkdir('migration/reports',{recursive:true});
  await writeFile(`migration/reports/dismissed-before-${Date.now()}.json`,JSON.stringify({source:{active:active.jobs.map(j=>j.id),archive:archive.jobs.map(j=>j.id),dismissed},documents:pending},null,2));
  let transaction=client.transaction();
  for(const doc of pending)transaction=transaction.patch(doc._id,p=>p.ifRevisionId(doc._rev).set({dismissed:true}));
  await transaction.commit({visibility:'sync'});
  assert.equal((await findUnlinkedReportIds(branchJobs)).length,0);
  console.log(JSON.stringify({restored:pending.length,unlinked:0}));
}
