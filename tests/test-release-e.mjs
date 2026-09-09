import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.ADMIN_SECRET = "release-e-test-secret";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  admitPublicAnalysis, createPublicRunToken, getPublicRunReceipt, publicAnalysisFingerprint,
  publicAnalysisLimits, releasePublicAnalysisClaim, savePublicRunReceipt, verifyPublicRunToken,
} = await import(pathToFileURL(path.join(root, "lib/public-analysis.js")));

let pass = 0, fail = 0;
function check(name, condition, evidence) {
  if (condition) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (evidence !== undefined ? "  -> " + JSON.stringify(evidence) : "")); }
}

console.log("\n--- public limits and atomic unique admission ---");
const defaults = publicAnalysisLimits({});
check("posting limit is 20,000 characters", defaults.maxCharacters === 20_000, defaults);
check("hourly IP limit is 10", defaults.perIpHourly === 10, defaults);
check("daily unique limit is 60", defaults.uniqueDaily === 60, defaults);

const jd = "A sufficiently detailed platform engineering leadership position for duplicate testing.";
const fingerprint = publicAnalysisFingerprint(jd);
const duplicateIds = Array.from({ length: 20 }, (_, i) => `duplicate_request_${String(i).padStart(2, "0")}`);
const duplicates = await Promise.all(duplicateIds.map((requestId) => admitPublicAnalysis({
  fingerprint, requestId, clientKey: `client_${requestId}`, limits: { perIpHourly: 1, uniqueDaily: 1 }, now: Date.UTC(2030, 0, 1, 1),
})));
check("all concurrent duplicates are accepted", duplicates.every((item) => item.allowed), duplicates);
check("duplicates share exactly one request", new Set(duplicates.map((item) => item.requestId)).size === 1);
check("exactly one duplicate owns the reservation", duplicates.filter((item) => !item.shared).length === 1);

const boundary = await Promise.all([0, 1, 2].map((i) => admitPublicAnalysis({
  fingerprint: `unique_daily_${i}`, requestId: `daily_boundary_req_${i}`, clientKey: `daily_client_${i}`,
  limits: { perIpHourly: 10, uniqueDaily: 2 }, now: Date.UTC(2030, 0, 2, 1),
})));
check("daily boundary accepts only the configured count", boundary.filter((item) => item.allowed).length === 2, boundary);
check("daily boundary rejects before any worker call", boundary[2].reason === "day", boundary[2]);

const hourly = await Promise.all([0, 1].map((i) => admitPublicAnalysis({
  fingerprint: `unique_hourly_${i}`, requestId: `hourly_boundary_req_${i}`, clientKey: "one_client",
  limits: { perIpHourly: 1, uniqueDaily: 10 }, now: Date.UTC(2030, 0, 3, 1),
})));
check("IP boundary admits one unique request", hourly[0].allowed && !hourly[1].allowed && hourly[1].reason === "ip", hourly);

console.log("\n--- failed work can be retried deliberately ---");
const retryFingerprint = "retry_fingerprint";
const first = await admitPublicAnalysis({ fingerprint: retryFingerprint, requestId: "retry_request_first", clientKey: "retry_client",
  limits: { perIpHourly: 5, uniqueDaily: 5 }, now: Date.UTC(2030, 0, 4, 1) });
check("first attempt owns the claim", first.allowed && !first.shared, first);
check("another request initially shares it", (await admitPublicAnalysis({ fingerprint: retryFingerprint,
  requestId: "retry_request_other", clientKey: "other_client", limits: { perIpHourly: 5, uniqueDaily: 5 }, now: Date.UTC(2030, 0, 4, 1) })).shared);
check("only the owner can release", !(await releasePublicAnalysisClaim(retryFingerprint, "wrong_request")));
check("failure releases the owner claim", await releasePublicAnalysisClaim(retryFingerprint, first.requestId));
const retried = await admitPublicAnalysis({ fingerprint: retryFingerprint, requestId: "retry_request_second", clientKey: "retry_client",
  limits: { perIpHourly: 5, uniqueDaily: 5 }, now: Date.UTC(2030, 0, 4, 1) });
check("retry gets a fresh claim", retried.allowed && !retried.shared && retried.requestId === "retry_request_second", retried);

console.log("\n--- scoped public receipts and tokens ---");
const receipt = await savePublicRunReceipt({ requestId: "public_receipt_request", inputId: "public_receipt_request",
  fingerprint: "safe_fingerprint", runId: "run_public_only", status: "queued" });
const saved = await getPublicRunReceipt("public_receipt_request");
check("receipt is explicitly public-analysis", saved.kind === "public-analysis", saved);
check("receipt contains no posting, IP, notes, or scoring", !/(posting|description|\bip\b|notes|score|rationale|draft)/i.test(JSON.stringify(saved)), saved);
const token = createPublicRunToken("public_receipt_request");
check("token verifies only for its request", verifyPublicRunToken("public_receipt_request", token));
check("foreign request cannot reuse token", !verifyPublicRunToken("admin_or_foreign_run", token));
check("expired token is rejected", !verifyPublicRunToken("public_receipt_request", createPublicRunToken("public_receipt_request", process.env, 1)));

console.log("\n--- transport and worker keep data small ---");
const api = fs.readFileSync(path.join(root, "api/analyze.js"), "utf8");
const task = fs.readFileSync(path.join(root, "src/trigger/public-analysis.ts"), "utf8");
const work = fs.readFileSync(path.join(root, "lib/public-analysis-work.js"), "utf8");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
check("public API accepts request IDs rather than Trigger run IDs", api.includes("request: String") === false && !api.includes("req.query?.run"));
check("public status returns only a report ID on completion", api.includes("reportId: result.reportId") && !api.includes("result: run.output"));
check("task payload is reference-only", /inputId: string;\s*fingerprint: string/.test(task) && !/jobDescription/.test(task));
check("worker pins the public model server-side", work.includes("model: PUBLIC_MODEL") && !/\{[^}]*model[^}]*\}\)\s*\{/.test(work));
check("usage ref is the public request ID", work.includes("ref: requestId"));
check("worker output excludes report and private scoring bodies", !/return \{[^}]*report:|return \{[^}]*internal:/s.test(work));
check("browser resumes an active request from the URL", html.includes('params.get("p")') && html.includes('params.get("t")'));
check("pending token cannot leak through referrers", html.includes('meta name="referrer" content="no-referrer"'));
check("browser loads the public report projection after completion", html.includes('fetch("/api/report?id="'));

console.log("\n--- admission endpoint projects the run safely ---");
const sdk = await import("@trigger.dev/sdk");
let triggered = null;
sdk.idempotencyKeys.create = async () => "idem_public";
sdk.tasks.trigger = async (taskId, payload, options) => {
  triggered = { taskId, payload, options };
  return { id: "run_private_trigger_id" };
};
sdk.runs.retrieve = async () => ({ id: "run_private_trigger_id", status: "COMPLETED",
  metadata: { phase: "saving", private: "must not pass through" },
  output: { outcome: "completed", requestId: "endpoint_request_01", reportId: "public_report_id", cached: false,
    internal: { score: 99 } } });
const analyzeHandler = (await import(pathToFileURL(path.join(root, "api/analyze.js")))).default;
function mockRes() {
  return { statusCode: 0, body: null, headers: {}, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, setHeader(name, value) { this.headers[name] = value; } };
}
let response = mockRes();
await analyzeHandler({ method: "POST", headers: { "x-forwarded-for": "198.51.100.8" }, socket: {}, body: {
  requestId: "endpoint_request_01", jobDescription: "A unique and sufficiently detailed public endpoint test role for a platform engineering leader.",
  model: "claude-opus-5", notes: "private browser field",
} }, response);
check("new public work returns 202", response.statusCode === 202, response.body);
check("response hides the Trigger run ID", !JSON.stringify(response.body).includes("run_private_trigger_id"), response.body);
check("dispatch payload carries only references", JSON.stringify(Object.keys(triggered.payload).sort()) === JSON.stringify(["fingerprint", "inputId", "requestId"]), triggered);
check("browser-supplied model and notes are discarded", !JSON.stringify(triggered).includes("claude-opus-5") && !JSON.stringify(triggered).includes("private browser field"));
const admission = await getPublicRunReceipt("endpoint_request_01");
const endpointToken = createPublicRunToken(admission.requestId);
response = mockRes();
await analyzeHandler({ method: "GET", query: { request: admission.requestId, token: endpointToken } }, response);
check("status returns the public report pointer", response.statusCode === 200 && response.body.reportId === "public_report_id", response.body);
check("status strips metadata, run ID, and private output", !/(run_private|private|internal|score)/i.test(JSON.stringify(response.body)), response.body);
response = mockRes();
await analyzeHandler({ method: "GET", query: { request: "admin_or_foreign_run", token: endpointToken } }, response);
check("foreign/admin IDs are inaccessible", response.statusCode === 404, response.body);

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
