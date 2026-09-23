import {mkdir, writeFile, rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createClient} from '@vercel/kv';

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_READ_ONLY_TOKEN || process.env.KV_REST_API_TOKEN;
if (!url || !token || [url, token].some(v => v.includes('[SENSITIVE]'))) {
  throw new Error('Real KV URL and read-only token are required; no memory fallback.');
}
const client = createClient({url, token});
const startedAt = new Date().toISOString();
const records = [];
const seen = new Set();
let cursor = 0;
do {
  const page = await client.scan(cursor, {count: 100});
  cursor = Number(page[0]);
  for (const key of page[1]) {
    if (seen.has(key)) continue;
    seen.add(key);
    const type = await client.type(key);
    let value;
    if (type === 'string') value = await client.get(key);
    else if (type === 'set') value = await client.smembers(key);
    else if (type === 'zset') value = await client.zrange(key, 0, -1, {withScores: true});
    else if (type === 'hash') value = await client.hgetall(key);
    else if (type === 'list') value = await client.lrange(key, 0, -1);
    else if (type === 'none') continue;
    else throw new Error(`Unsupported Redis type: ${type}`);
    records.push({key, type, ttl: await client.ttl(key), value});
  }
} while (cursor !== 0);
records.sort((a, b) => a.key.localeCompare(b.key));
const snapshot = {version: 1, startedAt, finishedAt: new Date().toISOString(), records};
const json = JSON.stringify(snapshot, null, 2);
const stamp = startedAt.replaceAll(':', '-');
await mkdir('migration/extracted', {recursive: true});
await writeFile(`migration/extracted/${stamp}.json`, json, {flag: 'wx'});
await writeFile('migration/extracted/latest.json.tmp', json);
await rename('migration/extracted/latest.json.tmp', 'migration/extracted/latest.json');
const counts = {};
for (const {key} of records) counts[key.split(':')[0]] = (counts[key.split(':')[0]] || 0) + 1;
console.log(JSON.stringify({startedAt, finishedAt: snapshot.finishedAt, records: records.length,
  sha256: createHash('sha256').update(json).digest('hex'), prefixes: counts}, null, 2));
