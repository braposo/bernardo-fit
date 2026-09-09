import { idempotencyKeys, runs, tasks } from "@trigger.dev/sdk";
import { analysisContext } from "../lib/analyze.js";
import { PUBLIC_MODEL } from "../lib/models.js";
import {
  admitPublicAnalysis, createPublicRunToken, getPublicRunReceipt, publicAnalysisFingerprint,
  publicAnalysisLimits, publicClientKey, releasePublicAnalysisClaim, savePublicRunReceipt,
  verifyPublicRunToken,
} from "../lib/public-analysis.js";
import { linkPublicAnalysisToPipeline } from "../lib/public-analysis-work.js";
import { publicReport } from "../lib/report.js";
import { findReportByHash } from "../lib/store.js";
import { saveTaskInput } from "../lib/task-results.js";
import { PUBLIC_ANALYSIS_TASK_ID, TERMINAL_RUN_STATUSES, publicAnalysisDispatchEnabled } from "../lib/task-policy.js";

const validRequestId = (value) => /^[a-zA-Z0-9_-]{16,100}$/.test(String(value || "")) ? String(value) : "";
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

async function status(req, res) {
  const requestId = validRequestId(req.query?.request);
  if (!requestId || !verifyPublicRunToken(requestId, req.query?.token)) {
    return res.status(404).json({ error: "Analysis not found" });
  }
  const receipt = await getPublicRunReceipt(requestId);
  if (!receipt || receipt.kind !== "public-analysis") {
    return res.status(200).json({ status: "dispatching", phase: "queued", terminal: false });
  }
  if (receipt.status === "dispatch_failed") {
    await releasePublicAnalysisClaim(receipt.fingerprint, requestId);
    return res.status(200).json({ status: "failed", phase: "failed", terminal: true,
      error: "The analysis could not start. Please try again." });
  }
  if (!receipt.runId) return res.status(200).json({ status: "dispatching", phase: "queued", terminal: false });
  const run = await runs.retrieve(receipt.runId);
  const terminal = TERMINAL_RUN_STATUSES.has(run.status);
  if (terminal && run.status !== "COMPLETED") await releasePublicAnalysisClaim(receipt.fingerprint, requestId);
  const result = run.status === "COMPLETED" && run.output && typeof run.output.reportId === "string" ? run.output : null;
  return res.status(200).json({
    status: run.status, terminal,
    phase: result ? "completed" : run.metadata?.phase || (terminal ? "failed" : "queued"),
    ...(result ? { reportId: result.reportId, cached: !!result.cached } : {}),
    ...(terminal && !result ? { error: "The analysis did not finish. Please try again." } : {}),
  });
}

async function start(req, res) {
  const { jobDescription } = req.body || {};
  const limits = publicAnalysisLimits();
  if (typeof jobDescription !== "string" || jobDescription.trim().length < 20) {
    return res.status(400).json({ error: "Please paste a fuller job description." });
  }
  const jd = jobDescription.trim();
  if (jd.length > limits.maxCharacters) {
    return res.status(413).json({ error: `Please keep the job description under ${limits.maxCharacters.toLocaleString()} characters.` });
  }
  const existing = await findReportByHash(jd, { model: PUBLIC_MODEL, generation: analysisContext() });
  if (existing) {
    await linkPublicAnalysisToPipeline(existing.id, existing.report, jd, null);
    return res.status(200).json({ id: existing.id, report: publicReport(existing.report), cached: true });
  }
  if (!publicAnalysisDispatchEnabled()) return res.status(503).json({ error: "New analyses are temporarily paused." });
  const proposedId = validRequestId(req.body?.requestId);
  if (!proposedId) return res.status(400).json({ error: "Missing valid requestId" });
  const fingerprint = publicAnalysisFingerprint(jd);
  const admitted = await admitPublicAnalysis({ fingerprint, requestId: proposedId,
    clientKey: publicClientKey(clientIp(req)), limits });
  if (!admitted.allowed) {
    res.setHeader("Retry-After", String(admitted.retryAfter));
    return res.status(429).json({ error: admitted.reason === "day"
      ? "Today's analysis capacity has been reached. Please try again tomorrow."
      : "That's a lot of analyses in a short time. Please try again later." });
  }
  const requestId = admitted.requestId;
  const token = createPublicRunToken(requestId);
  const prior = await getPublicRunReceipt(requestId);
  if (prior?.runId || (admitted.shared && requestId !== proposedId)) {
    return res.status(202).json({ requestId, token, cached: false, shared: true });
  }
  await saveTaskInput("public-analysis", requestId, jd);
  await savePublicRunReceipt({ requestId, inputId: requestId, fingerprint, status: "dispatching" });
  try {
    const key = await idempotencyKeys.create(`public-analysis:${requestId}`, { scope: "global" });
    const handle = await tasks.trigger(PUBLIC_ANALYSIS_TASK_ID, { requestId, inputId: requestId, fingerprint }, {
      idempotencyKey: key, idempotencyKeyTTL: "24h", tags: ["public-analysis", `request:${requestId}`],
    });
    await savePublicRunReceipt({ requestId, inputId: requestId, fingerprint, runId: handle.id, status: "queued" });
    return res.status(202).json({ requestId, token, cached: false, shared: admitted.shared });
  } catch (error) {
    await savePublicRunReceipt({ requestId, inputId: requestId, fingerprint, status: "dispatch_failed" });
    await releasePublicAnalysisClaim(fingerprint, requestId);
    throw error;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    if (req.method === "GET") return await status(req, res);
    if (req.method === "POST") return await start(req, res);
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "Unexpected error" });
  }
}
