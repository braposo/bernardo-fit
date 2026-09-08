// Concurrency and projection regressions for the shared storage boundary.
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
process.env.ADMIN_SECRET = "test-secret-value";

const store = await import("file:///" + root + "lib/store.js");
const receipts = await import("file:///" + root + "lib/run-receipts.js");
const jobsHandler = (await import("file:///" + root + "api/admin/jobs.js")).default;

let pass = 0, fail = 0;
function check(name, condition, evidence) {
  if (condition) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (evidence === undefined ? "" : "  -> " + JSON.stringify(evidence).slice(0, 250))); }
}
function mockRes() {
  const res = { statusCode: 0, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = () => res;
  return res;
}

console.log("\n--- concurrent field edits merge ---");
const job = await store.saveJob({ company: "Concurrent", role: "Lead", notes: "old", stage: "new" });
await Promise.all([
  store.updateJob(job.id, { notes: "kept note" }),
  store.updateJob(job.id, { stage: "interviewing" }),
]);
let current = await store.getJob(job.id);
check("notes survive", current.notes === "kept note", current);
check("stage survives", current.stage === "interviewing", current);
check("both writes advanced the revision", current.revision === job.revision + 2, current.revision);

console.log("\n--- question mutations do not replace the array ---");
await store.editQuestion(job.id, { id: "one", q: "First?", limit: 100 });
await Promise.all([
  store.editQuestion(job.id, { id: "two", q: "Second?", limit: 80 }),
  store.mutateJob(job.id, (latest) => ({
    questions: latest.questions.map((q) => q.id === "one" ? { ...q, a: "An answer", answeredAt: "now" } : q),
  })),
]);
current = await store.getJob(job.id);
check("new question survives answer write", current.questions.some((q) => q.id === "two"), current.questions);
check("answer survives question write", current.questions.find((q) => q.id === "one").a === "An answer", current.questions);

console.log("\n--- list and detail have separate projections ---");
await store.updateJob(job.id, {
  jobDescription: "Private full posting text that should not be in the board list.",
  notes: "Private notes that should load on demand.",
  instructions: "Private instructions.",
});
let res = mockRes();
await jobsHandler({ method: "GET", headers: { "x-admin-secret": "test-secret-value" }, query: {} }, res);
const summary = res.body.jobs.find((row) => row.id === job.id);
check("summary marks description presence", summary.hasDescription === true, summary);
check("summary omits description", !("jobDescription" in summary), summary);
check("summary omits notes", !("notes" in summary), summary);
check("summary omits questions", !("questions" in summary), summary);

res = mockRes();
await jobsHandler({ method: "GET", headers: { "x-admin-secret": "test-secret-value" }, query: { id: job.id } }, res);
check("detail returns description", res.body.job.jobDescription.includes("Private full posting"), res.body.job);
check("detail returns notes", res.body.job.notes.includes("Private notes"), res.body.job);
check("detail returns questions", res.body.job.questions.length === 2, res.body.job.questions);

res = mockRes();
await jobsHandler({ method: "GET", headers: { "x-admin-secret": "test-secret-value" }, query: { q: '"private full"' } }, res);
check("server search covers omitted text", res.body.matchingIds.includes(job.id), res.body);

console.log("\n--- report reuse mappings follow live content ---");
const generation = { prompt: "p", instructions: "i" };
const reportA = { job_title: "A", company: "C", job_description: "Description alpha", model: "m", generation, created_at: new Date().toISOString() };
const reportB = { ...reportA, job_title: "B", job_description: "Description beta" };
const reportId = await store.saveReport(reportA, null);
check("first content resolves", (await store.findReportByHash(reportA.job_description, { model: "m", generation }))?.id === reportId);
await store.overwriteReport(reportId, reportB);
check("old content no longer resolves", (await store.findReportByHash(reportA.job_description, { model: "m", generation })) === null);
check("new content resolves", (await store.findReportByHash(reportB.job_description, { model: "m", generation }))?.id === reportId);

const otherId = await store.saveReport({ ...reportB, job_title: "Other" }, null);
await store.overwriteReport(reportId, { ...reportB, job_title: "Latest" });
await store.deleteReport(otherId);
check("deleting another report cannot remove the live mapping", (await store.findReportByHash(reportB.job_description, { model: "m", generation }))?.id === reportId);

console.log("\n--- a job attachment can guard the report revision ---");
const guarded = await store.saveJob({ company: "Guarded", role: "R", fitReportId: reportId });
const expectedReportRevision = await store.getReportRevision(reportId);
await store.overwriteReport(reportId, { ...reportB, job_title: "Changed again" });
let reportConflict = null;
try {
  await store.updateJob(guarded.id, { notes: "must not attach" }, {
    expectedReportRevision: { id: reportId, revision: expectedReportRevision },
  });
} catch (error) {
  reportConflict = error;
}
check("changed report rejects the attachment", reportConflict?.code === "REPORT_CHANGED", reportConflict?.message);
check("rejected attachment writes nothing", (await store.getJob(guarded.id)).notes === "");

console.log("\n--- run receipts stay small and resolve both ways ---");
const receipt = await receipts.saveRunReceipt({
  kind: "cover", requestId: "receipt01", runId: "run_01", jobId: guarded.id, fingerprint: "abc",
});
check("request identity recovers the run", (await receipts.getReceiptForRequest("cover", guarded.id, "receipt01")).runId === "run_01");
check("run identity recovers the owner", (await receipts.getRunReceipt("run_01")).jobId === guarded.id);
check("receipt has no job or prompt body", !("payload" in receipt) && !("output" in receipt));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
