// Guards the inbox import against re-adding roles already in the pipeline.
//
// Every case here is a duplicate that actually reached production. The scan
// composes its own externalId from the company and role it read, and that text
// is not stable: the same LinkedIn posting is "Engineering Manager, AI/Agentic
// Systems" in one digest and "Engineering Manager, AI & Agentic Systems" in the
// next, so the ids differed, the exact-id match missed, and a second row opened
// on top of one already applied to. One of them resurrected a role filed away
// as not_a_fit.
//
// The fixtures use the real companies and posting ids, because the point is
// that these specific pairs collapse.

import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

process.env.ADMIN_SECRET = "test-secret-value";
const store = await import(base + "_store.js");
const ingest = (await import(base + "admin/ingest.js")).default;

let pass = 0, fail = 0;
const check = (n, c, e) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e) : "")); }
};
function mockRes() {
  const r = { statusCode: 0, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  r.setHeader = () => r;
  return r;
}
const auth = { "x-admin-secret": "test-secret-value" };
const send = async (opportunities) => {
  const res = mockRes();
  await ingest({ method: "POST", headers: auth, body: { opportunities } }, res);
  return res.body;
};
const LI = (id) => "https://www.linkedin.com/comm/jobs/view/" + id + "/?trackingId=" + Math.random();

console.log("\n--- the pipeline as it stood before the bad run ---");
const applied = await store.saveJob({
  company: "Formula.", role: "Engineering Manager, AI/Agentic Systems",
  externalId: "formula--engineering-manager-ai-agentic", threadId: "1a043c8babbc087e",
  sourceUrl: LI("4448865017"), stage: "applied",
});
const filed = await store.saveJob({
  company: "Formula.", role: "Software Engineering Manager",
  externalId: "formula--software-engineering-manager", threadId: "1a043c8babbc087e",
  sourceUrl: LI("4448144773"), stage: "not_a_fit", archived: true,
});
const lafosse = await store.saveJob({
  company: "via La Fosse", role: "Engineering Manager",
  externalId: "la-fosse--engineering-manager", threadId: "1a043c8babbc087e",
  sourceUrl: LI("4454244517"), stage: "applied",
});
const before = (await store.listJobs({ includeArchived: true })).length;
check("three rows to start", before === 3, before);

console.log("\n--- the same three roles, re-read with drifted titles ---");
const body = await send([
  // Punctuation drift only. The title means the same thing.
  { externalId: "formula--engineering-manager-ai-agentic-systems", threadId: "1a043c8babbc087e",
    company: "Formula.", role: "Engineering Manager, AI & Agentic Systems" },
  // A qualifier the digest did not carry, but the posting id is the same one.
  { externalId: "formula--software-engineering-manager-identity", threadId: "1a043c8babbc087e",
    company: "Formula.", role: "Software Engineering Manager", sourceUrl: LI("4448144773") },
  // Same again, with no URL to fall back on.
  { externalId: "la-fosse--engineering-manager-consumer-platform", threadId: "1a043c8babbc087e",
    company: "via La Fosse", role: "Engineering Manager" },
]);

check("nothing was added", body.added === 0, body);
check("all three folded in", body.updated === 3, body);
check("the row count did not move", (await store.listJobs({ includeArchived: true })).length === 3);

console.log("\n--- and nothing the user owns was touched ---");
const now = await store.listJobs({ includeArchived: true });
const by = (id) => now.find((j) => j.id === id);
check("an applied role stays applied", by(applied.id).stage === "applied", by(applied.id).stage);
check("a role filed as not_a_fit stays filed", by(filed.id).stage === "not_a_fit", by(filed.id).stage);
check("and stays archived rather than resurfacing", by(filed.id).archived === true);
check("the second applied role stays applied", by(lafosse.id).stage === "applied");

console.log("\n--- each fold is reported, not silent ---");
check("three merges reported", (body.mergedRows || []).length === 3, body.mergedRows);
const reasons = (body.mergedRows || []).map((m) => m.matchedOn).sort();
check("one matched on the posting id", reasons.filter((r) => r === "posting id").length === 1, reasons);
check("two on company and role", reasons.filter((r) => r === "company and role").length === 2, reasons);
check("each names the id it was sent as", (body.mergedRows || []).every((m) => /^(formula|la-fosse)--/.test(m.sentAs)));

console.log("\n--- a genuinely different role still gets its own row ---");
const other = await send([
  { externalId: "stora--engineering-manager", threadId: "1a04e1579346bfcb",
    company: "Stora", role: "Engineering Manager", sourceUrl: LI("4460505512") },
  // Same company as one already held, different role. Must not fold.
  { externalId: "formula--staff-engineer", threadId: "1a043c8babbc087e",
    company: "Formula.", role: "Staff Engineer" },
]);
check("both were added", other.added === 2, other);
check("nothing was reported as merged", (other.mergedRows || []).length === 0, other.mergedRows);
check("five rows now", (await store.listJobs({ includeArchived: true })).length === 5);

console.log("\n--- re-sending the same batch is still a no-op ---");
const again = await send([
  { externalId: "stora--engineering-manager", threadId: "1a04e1579346bfcb",
    company: "Stora", role: "Engineering Manager", sourceUrl: LI("4460505512") },
]);
check("idempotent", again.added === 0 && again.updated === 1, again);
check("and reports no drift when the id is unchanged", (again.mergedRows || []).length === 0);

console.log("\n--- a posting id survives the tracking junk around it ---");
check("id read from a comm URL", store.postingId(LI("4460505512")) === "4460505512");
check("id read from a plain URL", store.postingId("https://www.linkedin.com/jobs/view/4460505512") === "4460505512");
check("no id in a search URL", store.postingId("https://www.linkedin.com/jobs/search-results/?keywords=x") === "");
check("no id in nothing", store.postingId("") === "" && store.postingId(null) === "");

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
