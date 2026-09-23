import assert from 'node:assert/strict';
import { auth } from '@trigger.dev/sdk';
import adminHandler from '../api/admin/cover.js';
import publicHandler from '../api/analyze.js';
import { saveRunReceipt } from '../lib/run-receipts.js';
import { createPublicRunToken, savePublicRunReceipt } from '../lib/public-analysis.js';

process.env.ADMIN_SECRET = 'fixture-admin-secret';
const minted = [];
auth.createPublicToken = async options => { minted.push(options); return 'fixture-scoped-token'; };
function response() {
  return { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}
await saveRunReceipt({ kind: 'answer', jobId: 'job1', questionId: 'q1', requestId: 'request123', runId: 'run_admin' });
let res = response();
await adminHandler({ method: 'GET', headers: {}, query: { run: 'run_admin', realtime: '1' } }, res);
assert.equal(res.code, 401); assert.equal(minted.length, 0);
res = response();
await adminHandler({ method: 'GET', headers: { 'x-admin-secret': process.env.ADMIN_SECRET }, query: { run: 'run_admin', realtime: '1' } }, res);
assert.equal(res.body.runId, 'run_admin'); assert.equal(res.body.questionId, 'q1');
assert.deepEqual(minted[0].scopes, { read: { runs: ['run_admin'] } });
assert.deepEqual(minted[0].realtime.skipColumns, ['payload', 'output', 'error']);
const id = 'public_request_123456';
await savePublicRunReceipt({ requestId: id, runId: 'run_public', status: 'queued' });
res = response();
await publicHandler({ method: 'GET', headers: {}, query: { request: id, token: 'wrong', realtime: '1' } }, res);
assert.equal(res.code, 404); assert.equal(minted.length, 1);
res = response();
await publicHandler({ method: 'GET', headers: {}, query: { request: id, token: createPublicRunToken(id), realtime: '1' } }, res);
assert.equal(res.body.runId, 'run_public'); assert.equal(res.body.publicAccessToken, 'fixture-scoped-token');
assert.deepEqual(minted[1].scopes, { read: { runs: ['run_public'] } });
assert.deepEqual(minted[1].realtime.skipColumns, ['payload', 'output', 'error']);
console.log('passed 12, failed 0');
