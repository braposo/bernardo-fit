import { readFile } from 'node:fs/promises';
import { hasKV, kv } from '../lib/kv.js';

if (!hasKV || !process.argv[2]) throw new Error('Provide the old checkpoint file and production KV credentials');
const old = JSON.parse(await readFile(process.argv[2], 'utf8'));
const date = old.linkedin?.lastSuccessfulScan;
if (!date || !Number.isFinite(Date.parse(date)) || Date.parse(date) > Date.now())
  throw new Error('The file has no valid LinkedIn success checkpoint');
const client = await kv();
const seeded = await client.set('linkedin-discovery:last-success', new Date(date).toISOString(), { nx: true });
console.log(seeded ? 'LinkedIn checkpoint migrated; email state was not imported.' : 'Worker checkpoint already exists; left unchanged.');
