import {readFile, writeFile} from 'node:fs/promises';
const source = JSON.parse(await readFile('migration/extracted/admin-export.json', 'utf8'));
const get = async params => {
  const response = await fetch(`https://fit.bernardoraposo.com/api/admin/versions?${new URLSearchParams(params)}`, {
    headers: {'x-admin-secret': process.env.ADMIN_SECRET}, redirect: 'error', signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Artifact export HTTP ${response.status}`);
  return response.json();
};
const artifacts = [];
for (const job of source.jobs) {
  if (!job.coverLetterId && !job.researchId && !job.briefId) continue;
  const versions = await get({id: job.id});
  // Only use versions explicitly returned by the app, plus current pointers.
  const requested = new Map();
  for (const kind of ['letter', 'research', 'brief']) {
    const rows = versions[kind] || versions[`${kind}s`] || [];
    for (const row of rows) if (row.vid) requested.set(`${kind}:${row.vid}`, {kind, ...row});
    const vid = job[{letter: 'coverLetterId', research: 'researchId', brief: 'briefId'}[kind]];
    if (vid) requested.set(`${kind}:${vid}`, {...requested.get(`${kind}:${vid}`), kind, vid});
  }
  for (const row of requested.values()) {
    const {content} = await get({id: job.id, kind: row.kind, vid: row.vid});
    artifacts.push({jobId: job.id, ...row, ...content});
  }
}
await writeFile('migration/extracted/admin-artifacts.json', JSON.stringify({exportedAt: new Date().toISOString(), artifacts}, null, 2));
console.log(JSON.stringify({artifacts: artifacts.length, counts: Object.fromEntries(['letter','research','brief'].map(k=>[k,artifacts.filter(a=>a.kind===k).length])), limitation: 'Admin preview projections omit some provenance and inaccessible/orphaned artifacts. Reading previews records normal audit events.'}));
