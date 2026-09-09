import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lib = (name) => import("file:///" + path.join(root, "lib", name).replace(/\\/g, "/"));
const { analysisChildRequestId, summariseAnalysisBatch } = await lib("analyse-all.js");
const { executeIngestBatch, ingestIdentity } = await lib("ingest-work.js");
const { applyAnalysisToOwners } = await lib("analysis-completion.js");
const store = await lib("store.js");
const { jobSummary } = await lib("job-view.js");

let pass = 0, fail = 0;
function check(name, condition, evidence) {
  if (condition) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (evidence === undefined ? "" : " -> " + JSON.stringify(evidence))); }
}

console.log("\n--- analyse-all child outcomes and retry identity ---");
const batchJobs = Array.from({ length: 5 }, (_, index) => ({ id: "job" + index, company: "Company " + index, role: "Role " + index }));
const runs = [
  { ok: true, output: { outcome: "completed" } },
  { ok: true, output: { outcome: "completed", cached: true } },
  { ok: false, error: { message: "injected failure" } },
  { ok: true, output: { outcome: "completed" } },
  { ok: true, output: { outcome: "completed" } },
];
const summary = summariseAnalysisBatch(batchJobs, runs);
check("four children succeed", summary.analysed === 4, summary);
check("one child fails", summary.failed === 1, summary);
check("failure names the child", summary.failures[0].company === "Company 2" && summary.failures[0].role === "Role 2", summary.failures);
check("cached completion is counted once", summary.cached === 1, summary);
const childA = analysisChildRequestId("parent_request_123", "job2");
check("parent retry reuses child identity", childA === analysisChildRequestId("parent_request_123", "job2"), childA);
check("different jobs get different child identities", childA !== analysisChildRequestId("parent_request_123", "job3"));

console.log("\n--- batch ingest matching and concurrent identity ---");
const first = await executeIngestBatch([
  { externalId: "same-1", company: "Acme", role: "Engineering Manager", jobDescription: "short" },
  { externalId: "same-1", company: "Acme", role: "Engineering Manager", jobDescription: "a much longer description" },
]);
check("matches a row created earlier in the upload", first.added === 1 && first.updated === 1, first);
let rows = await store.listJobs({ includeArchived: true });
check("one upload identity produces one row", rows.length === 1, rows);
check("longer posting wins", rows[0].jobDescription === "a much longer description", rows[0].jobDescription);
await Promise.all([
  executeIngestBatch([{ externalId: "race-1", company: "Race Co", role: "Director", threadId: "thread-a" }]),
  executeIngestBatch([{ externalId: "race-2", company: "Race Co", role: "Director", threadId: "thread-b" }]),
]);
rows = await store.listJobs({ includeArchived: true });
check("concurrent creates share deterministic identity", rows.filter((row) => row.company === "Race Co").length === 1, rows);
check("identity is stable", ingestIdentity({ company: "Race Co", role: "Director" }) === ingestIdentity({ company: "Race Co", role: "Director" }));

console.log("\n--- shared completion and minimal reload pointers ---");
const reportId = await store.saveReport({ company: "Shared", job_title: "Lead", job_description: "x", created_at: new Date().toISOString() });
const one = await store.saveJob({ company: "Shared", role: "Lead", fitReportId: reportId });
const two = await store.saveJob({ company: "Agency", role: "Lead", fitReportId: reportId });
await applyAnalysisToOwners(reportId, { score: 84, tier: "Strong", breakdown: { evidence: 8 }, reasoning: "fit" });
check("shared owner one rescored", (await store.getJob(one.id)).score === 84);
check("shared owner two rescored", (await store.getJob(two.id)).score === 84);
const active = await store.saveJob({ company: "Question", role: "Role", jobDescription: "private posting",
  questions: [{ id: "q1", q: "Why?", run: { requestId: "req12345", runId: "run1", status: "queued" } }] });
const view = jobSummary(active);
check("summary omits posting", !("jobDescription" in view));
check("summary sends only active answer pointer", view.answerRuns.length === 1 && view.answerRuns[0].questionId === "q1", view.answerRuns);
check("summary omits question text", !JSON.stringify(view.answerRuns).includes("Why?"), view.answerRuns);

console.log("\n--- deployment surface and durable browser path ---");
const apiFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".js")) apiFiles.push(full);
  }
}
walk(path.join(root, "api"));
check("Vercel function surface is nine files", apiFiles.length === 9, apiFiles);
check("old synchronous handlers are deleted", ["analyse.js", "answer.js", "regenerate.js"].every((name) => !fs.existsSync(path.join(root, "api", "admin", name))));
const html = fs.readFileSync(path.join(root, "public", "admin.html"), "utf8");
check("browser uses the shared dispatch route", html.includes('kind: "analyse"') && html.includes('kind: "answer"') && html.includes('kind: "regenerate"'));
check("timestamp recovery is gone", !/recoverable|analysisLanded|answerLanded|regenLanded/.test(html));
const parent = fs.readFileSync(path.join(root, "src", "trigger", "analyse-all.ts"), "utf8");
check("parent uses Trigger batch wait", parent.includes("batchTriggerAndWait(items)"));
check("children use global idempotency", parent.includes('scope: "global"'));
const ingestRoute = fs.readFileSync(path.join(root, "api", "admin", "ingest.js"), "utf8");
check("ingest stores one referenced input", ingestRoute.includes('saveTaskInput("ingest", requestId, cleaned)'));
check("ingest responds asynchronously", ingestRoute.includes("res.status(202)"));
const answerWork = fs.readFileSync(path.join(root, "lib", "answer-work.js"), "utf8");
check("answer task output omits private draft bodies", !/return \{ outcome: "completed"[^;]*answer: result\.answer/s.test(answerWork));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
