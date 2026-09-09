import { requireAdmin } from "../lib/admin.js";
import { analysisFingerprint, answerFingerprint } from "../lib/generation-fingerprint.js";
import { executeAnalysisWork } from "../lib/analysis-work.js";
import { executeAnswerWork } from "../lib/answer-work.js";
import { executeIngestBatch } from "../lib/ingest-work.js";
import { getJob, getReport, listJobs, mutateJob } from "../lib/store.js";
import { resolveModel } from "../lib/models.js";

let sequence = 0;
const requestId = (kind) => `test_${kind}_${Date.now()}_${++sequence}`;
const fail = (res, error) => res.status(error.status || 500).json({ error: error.message || "Unexpected error" });

async function runAnalysis(job, model, mode = "create", reportId = "") {
  const wanted = resolveModel(model);
  const report = reportId ? await getReport(reportId) : job.fitReportId ? await getReport(job.fitReportId) : null;
  const rid = requestId(mode);
  const fingerprint = analysisFingerprint(job, wanted, mode, report);
  await mutateJob(job.id, () => ({ analysisRun: { requestId: rid, runId: rid, fingerprint,
    status: "queued", startedAt: new Date().toISOString(), finishedAt: "" } }));
  const result = await executeAnalysisWork({ jobId: job.id, reportId, requestId: rid, fingerprint, model: wanted, mode });
  return { ...result, model: wanted, ...(result.reportId ? { report: await getReport(result.reportId) } : {}),
    ...(mode === "replace" ? { rescored: true } : {}) };
}

export async function analyseHandler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    if (req.body?.all) {
      const pending = (await listJobs()).filter((job) => !job.fitReportId && String(job.jobDescription || "").trim().length >= 20);
      const results = [];
      for (const job of pending) {
        try { results.push(await runAnalysis(job, req.body.model)); }
        catch (error) { results.push({ error: error.message }); }
      }
      return res.status(200).json({ analysed: results.filter((r) => r.reportId).length,
        cached: results.filter((r) => r.cached).length, failed: results.filter((r) => r.error).length, pending: pending.length });
    }
    if (!req.body?.id) return res.status(400).json({ error: "Missing id" });
    const job = await getJob(req.body?.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (String(job.jobDescription || "").trim().length < 20) {
      return res.status(400).json({ error: "Add a fuller job description first." });
    }
    return res.status(200).json(await runAnalysis(job, req.body?.model));
  } catch (error) { return fail(res, error); }
}

export async function regenerateHandler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const reportId = req.body?.id;
    if (!reportId || !(await getReport(reportId))) return res.status(404).json({ error: "Report not found" });
    const owners = (await listJobs({ includeArchived: true })).filter((row) => row.fitReportId === reportId);
    const job = req.body?.jobId ? await getJob(req.body.jobId) : owners.find((row) => String(row.instructions || "").trim()) || owners[0] || null;
    if (req.body?.jobId && !job) return res.status(404).json({ error: "Job not found" });
    if (job) return res.status(200).json(await runAnalysis(job, req.body?.model, "replace", reportId));
    const model = resolveModel(req.body?.model);
    const rid = requestId("replace");
    const fingerprint = analysisFingerprint(null, model, "replace", await getReport(reportId));
    const result = await executeAnalysisWork({ reportId, requestId: rid, fingerprint, model, mode: "replace" });
    return res.status(200).json({ ...result, model, report: await getReport(reportId), rescored: false });
  } catch (error) { return fail(res, error); }
}

export async function answerHandler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const job = await getJob(req.body?.id);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (!req.body?.questionId) return res.status(400).json({ error: "Missing questionId" });
    const question = (job.questions || []).find((q) => q.id === req.body.questionId);
    if (!question) return res.status(404).json({ error: "Question not found" });
    if (!String(question.q || "").trim()) return res.status(400).json({ error: "Write the question first." });
    const model = resolveModel(req.body?.model);
    const report = job.fitReportId ? await getReport(job.fitReportId) : null;
    const rid = requestId("answer");
    const fingerprint = answerFingerprint(job, req.body?.questionId, model, report);
    await mutateJob(job.id, (current) => ({ questions: current.questions.map((q) => q.id === req.body.questionId
      ? { ...q, run: { requestId: rid, runId: rid, fingerprint, status: "queued",
        startedAt: new Date().toISOString(), finishedAt: "" } } : q) }));
    const result = await executeAnswerWork({ jobId: job.id, questionId: req.body.questionId,
      requestId: rid, fingerprint, model });
    const saved = (await getJob(job.id)).questions.find((q) => q.id === req.body.questionId);
    return res.status(200).json({ ...result, answer: saved.a, refused: saved.refused, reason: saved.reason });
  } catch (error) { return fail(res, error); }
}

export async function ingestHandler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!Array.isArray(req.body?.opportunities)) return res.status(400).json({ error: "Expected an opportunities array." });
  if (req.body.opportunities.length > 200) return res.status(400).json({ error: "Too many at once; send 200 or fewer." });
  try { return res.status(200).json(await executeIngestBatch(req.body.opportunities)); }
  catch (error) { return fail(res, error); }
}
