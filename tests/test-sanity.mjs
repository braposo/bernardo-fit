import assert from "node:assert/strict";
import { createContentClient } from "../lib/sanity/client.js";
import { contentStatus, listContent, readContent } from "../lib/sanity/content.js";
import { CANDIDATE_QUERY, JOB_CONTENT_QUERY } from "../lib/sanity/queries.js";
import handler from "../api/admin/content.js";

let passed = 0, failed = 0;
async function check(name, run) {
  try { await run(); passed++; }
  catch (error) { failed++; console.error("FAIL", name, error.message); }
}
await check("private, published, uncached client", () => {
  const config = createContentClient({ SANITY_READ_TOKEN: "test-viewer" }).config();
  assert.equal(config.projectId, "quli96gc");
  assert.equal(config.dataset, "production");
  assert.equal(config.perspective, "published");
  assert.equal(config.useCdn, false);
  assert.equal(config.token, "test-viewer");
});
await check("missing token fails closed", () => {
  assert.throws(() => createContentClient({}), { code: "SANITY_NOT_CONFIGURED" });
});
await check("empty dataset is connected, not cut over", async () => {
  const result = await contentStatus({ fetch: async () => ({ job: 0 }) });
  assert.equal(result.connected, true);
  assert.equal(result.mode, "prepared");
  assert.equal(result.activeAppStorage, "existing");
  assert.equal(result.counts.job, 0);
});
await check("query inputs are bound and pagination bounded", async () => {
  const calls = [];
  const client = { fetch: async (...args) => { calls.push(args); return []; } };
  await listContent("job", 50, client);
  assert.deepEqual(calls[0][1], { type: "job", start: 50, end: 100 });
  await assert.rejects(listContent('*] | order(_id)', 0, client), { status: 400 });
  for (const offset of [-1, 0.1, 10001, "oops", Infinity]) {
    await assert.rejects(listContent("job", offset, client), { status: 400 });
  }
  assert.equal(calls.length, 1);
});
await check("expanded candidate and job queries; drafts rejected", async () => {
  const calls = [];
  const client = { fetch: async (...args) => { calls.push(args); return null; } };
  await readContent("candidateProfile", "candidate-1", client);
  await readContent("job", "job-1", client);
  assert.equal(calls[0][0], CANDIDATE_QUERY);
  assert.equal(calls[1][0], JOB_CONTENT_QUERY);
  for (const id of ["drafts.secret", "versions.release.secret", 'bad"id', "", ["id"]]) {
    await assert.rejects(readContent("job", id, client), { status: 400 });
  }
  assert.equal(calls.length, 2);
});
function response() {
  return { code: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
}
process.env.ADMIN_SECRET = "sanity-test-admin";
delete process.env.SANITY_READ_TOKEN;
await check("anonymous request cannot access private content", async () => {
  const res = response();
  await handler({ method: "GET", headers: {}, query: {} }, res);
  assert.equal(res.code, 401);
  assert.equal(res.headers["Cache-Control"], "private, no-store");
});
await check("read connection cannot accept mutations", async () => {
  const res = response();
  await handler({ method: "POST", headers: { "x-admin-secret": process.env.ADMIN_SECRET } }, res);
  assert.equal(res.code, 405);
  assert.equal(res.headers.Allow, "GET");
});
await check("unconfigured connection gives actionable status", async () => {
  const res = response();
  await handler({ method: "GET", headers: { "x-admin-secret": process.env.ADMIN_SECRET }, query: {} }, res);
  assert.equal(res.code, 503);
  assert.match(res.body.error, /SANITY_READ_TOKEN/);
});
await check("malformed request rejected before connection", async () => {
  const res = response();
  await handler({ method: "GET", headers: { "x-admin-secret": process.env.ADMIN_SECRET },
    query: { type: "job", id: "drafts.private" } }, res);
  assert.equal(res.code, 400);
});
console.log(`passed ${passed}, failed ${failed}`);
process.exitCode = failed ? 1 : 0;
