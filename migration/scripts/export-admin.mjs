import {mkdir, writeFile} from 'node:fs/promises';
if (!process.env.ADMIN_SECRET || process.env.ADMIN_SECRET.includes('[SENSITIVE]')) throw new Error('Admin credential unavailable');
const response = await fetch('https://fit.bernardoraposo.com/api/admin/reports?export=1', {
  headers: {'x-admin-secret': process.env.ADMIN_SECRET}, redirect: 'error', signal: AbortSignal.timeout(180000),
});
if (!response.ok) throw new Error(`Export returned HTTP ${response.status}`);
const value = await response.json();
if (!Array.isArray(value.jobs) || !Array.isArray(value.reports)) throw new Error('Unexpected export format');
await mkdir('migration/extracted', {recursive: true});
await writeFile('migration/extracted/admin-export.json', JSON.stringify(value, null, 2));
console.log(JSON.stringify({counts: value.counts, exportedAt: value.exportedAt,
  limitation: 'Does not include separate artifact records, orphan records or task checkpoints.'}));
