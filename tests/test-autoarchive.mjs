process.env.ADMIN_SECRET = "test-secret-value";
process.env.ANTHROPIC_API_KEY = "sk-fake";
// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";
const lib = "file:///" + root + "lib/";

import fs from "node:fs";
globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" }) });

const store = await import(lib + "store.js");
const jobs = (await import(base + "admin/jobs.js")).default;

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 160) : "")); } };
function mockRes() {
  const r = { statusCode: 0, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r; r.setHeader = () => r;
  return r;
}
const auth = { "x-admin-secret": "test-secret-value", host: "fit.bernardoraposo.com" };
const patch = async (id, body) => { const r = mockRes(); await jobs({ method: "PATCH", headers: auth, query: { id }, body }, r); return r; };

console.log("\n--- terminal stages archive the row ---");
for (const stage of ["expired", "not_a_fit", "rejected", "not_interested"]) {
  const j = await store.saveJob({ company: "C", role: stage });
  check(stage + ": starts live", !j.archived);
  const r = await patch(j.id, { stage });
  check(stage + ": patch ok", r.statusCode === 200, r.body);
  const after = await store.getJob(j.id);
  check(stage + ": archived", after.archived === true);
  check(stage + ": stamped", !!after.archivedAt);
  check(stage + ": canonical stage kept", after.stage === (stage === "not_a_fit" ? "not_interested" : stage));
  check(stage + ": hidden from pipeline", !(await store.listJobs()).some(row => row.id === j.id));
  check(stage + ": visible in archive", (await store.listJobs({ onlyArchived: true })).some(row => row.id === j.id));
}

console.log("\n--- other stages do not ---");
for (const stage of ["reviewing", "applied", "interviewing", "offer"]) {
  const j = await store.saveJob({ company: "C", role: stage });
  await patch(j.id, { stage });
  const after = await store.getJob(j.id);
  check(stage + " stays in the pipeline", after.archived === false, after.archived);
}

console.log("\n--- restoring one is still possible ---");
const legacy = await store.saveJob({ company: "Legacy", role: "R", stage: "not_a_fit", archived: true, archivedAt: "2026-01-01T00:00:00.000Z", notes: "Keep these notes" });
check("legacy writes use the consolidated stage", legacy.stage === "not_interested");
check("legacy archive timestamp is preserved", legacy.archivedAt === "2026-01-01T00:00:00.000Z");
await patch(legacy.id, { archived: false });
const legacyRestored = await store.getJob(legacy.id);
check("consolidated jobs can be restored", !legacyRestored.archived && legacyRestored.stage === "not_interested");
check("restoring retains notes", legacyRestored.notes === "Keep these notes");
const r1 = await store.saveJob({ company: "C", role: "R" });
await patch(r1.id, { stage: "expired" });
check("archived first", (await store.getJob(r1.id)).archived === true);
await patch(r1.id, { archived: false });
const restored = await store.getJob(r1.id);
check("restored to the pipeline", restored.archived === false);
check("timestamp cleared", !restored.archivedAt);
check("still expired", restored.stage === "expired");

console.log("\n--- an explicit flag in the same patch wins ---");
const r2 = await store.saveJob({ company: "C", role: "R" });
await patch(r2.id, { stage: "not_a_fit", archived: false });
check("stays live when asked to", (await store.getJob(r2.id)).archived === false);

console.log("\n--- archived rows are where they belong ---");
const live = await store.listJobs();
check("no expired row in the pipeline", !live.some((j) => j.stage === "expired" && j.archived));
const archived = await store.listJobs({ onlyArchived: true });
check("expired rows are in the archive", archived.some((j) => j.stage === "expired"));

console.log("\n--- the page scopes the pipeline filter, not the role dropdown ---");
const html = fs.readFileSync(root + "public/admin.html", "utf8");
check("constant defined", html.includes('var ARCHIVE_ON_STAGE = ["expired", "rejected", "not_interested"];'));
check("only the consolidated status is offered", !html.includes('"not_a_fit"') && html.includes('"not_interested"'));
check("pipeline options are filtered", /var allowedStages = stages\.filter\(function \(s\) \{ return showArchived/.test(html));
check("role dropdown still offers every stage", /function stageOptions\(j\)[\s\S]{0,160}stages\.map/.test(html));
check("a stranded filter is cleared", html.includes("if (!showArchived && ARCHIVE_ON_STAGE.indexOf(stageFilter) !== -1) stageFilter = null;"));
check("list refetched when the row leaves", html.includes("var left = ARCHIVE_ON_STAGE.indexOf(next) !== -1 && !showArchived;"));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
