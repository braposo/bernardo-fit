// Guards deletion against being undone by the next adopt.
//
// Deleting a job row leaves its analysis in place on purpose, so a link already
// shared keeps resolving. But adopt offered every report with no row attached,
// so a deleted row was simply rebuilt from its own report the next time the
// button was pressed. Four duplicates deleted one morning were back the same
// evening — unarchived, at stage new, with fresh ids, so they did not even look
// like the rows that had been removed.

import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";
const lib = "file:///" + root + "lib/";

process.env.ADMIN_SECRET = "test-secret-value";
const store = await import(lib + "store.js");
const jobsHandler = (await import(base + "admin/jobs.js")).default;
const { executeAdoptReports } = await import(lib + "adopt-work.js");

let pass = 0, fail = 0;
const check = (n, c, e) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 200) : "")); }
};
function mockRes() {
  const r = { statusCode: 0, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r; r.setHeader = () => r;
  return r;
}
const auth = { "x-admin-secret": "test-secret-value" };
const adopt = async () => {
  return executeAdoptReports();
};
const del = async (id) => {
  const res = mockRes();
  await jobsHandler({ method: "DELETE", headers: auth, query: { id } }, res);
  return res.statusCode;
};
const rows = () => store.listJobs({ includeArchived: true });

console.log("\n--- an analysis with no row is offered once ---");
// created_at is what listReports filters on, so a fixture without it is
// invisible to everything downstream.
const repId = await store.saveReport(
  {
    company: "Contentful",
    job_title: "Engineering Manager - Content API",
    job_description: "C".repeat(600),
    created_at: "2026-08-29T23:49:07.270Z",
  },
  {}
);
check("a report was saved", !!repId, repId);
check("it counts as unlinked", (await store.findUnlinkedReportIds()).includes(repId));

const first = await adopt();
check("adopt builds a row for it", first.added === 1, first);
check("the pipeline has one row", (await rows()).length === 1);
check("and it is no longer unlinked", !(await store.findUnlinkedReportIds()).includes(repId));

console.log("\n--- adopting twice does not build it twice ---");
const second = await adopt();
check("nothing added the second time", second.added === 0, second);
check("still one row", (await rows()).length === 1);

console.log("\n--- once the row is deleted, it stays deleted ---");
const row = (await rows())[0];
check("the row carries the report", row.fitReportId === repId, row.fitReportId);
// Deletion is gated on archiving, which is what the page does first.
await store.updateJob(row.id, { archived: true });
check("delete succeeds", (await del(row.id)) === 200);
check("the pipeline is empty", (await rows()).length === 0);

check("the report is no longer offered", !(await store.findUnlinkedReportIds()).includes(repId));
const third = await adopt();
check("adopt does not resurrect it", third.added === 0, third);
check("the pipeline is still empty", (await rows()).length === 0, await rows());

console.log("\n--- the analysis itself is untouched ---");
// A link already shared has to keep resolving; only the pipeline row goes.
const still = await store.getReport(repId);
check("the report still resolves", !!still && still.company === "Contentful", still);

console.log("\n--- a deletion can be undone deliberately ---");
await store.undismissReport(repId);
check("it is offered again", (await store.findUnlinkedReportIds()).includes(repId));
const fourth = await adopt();
check("adopt rebuilds it on request", fourth.added === 1, fourth);
check("one row again", (await rows()).length === 1);

console.log("\n--- deleting a row with no analysis is still fine ---");
const bare = await store.saveJob({ company: "Stora", role: "Engineering Manager" });
await store.updateJob(bare.id, { archived: true });
check("delete succeeds", (await del(bare.id)) === 200);
check("and nothing else was disturbed", (await rows()).length === 1);
check("the other report is still linked", !(await store.findUnlinkedReportIds()).includes(repId));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
