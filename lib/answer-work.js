import { runAnswer } from "./answer.js";
import { answerFingerprint } from "./generation-fingerprint.js";
import { resolveModel } from "./models.js";
import { getTaskResult, saveTaskResult } from "./task-results.js";
import { getJob, getReport, getReportRevision, mutateJob } from "./store.js";

const done = () => new Date().toISOString();
async function mark(jobId, questionId, requestId, status) {
  await mutateJob(jobId, (current) => {
    const q = (current.questions || []).find((x) => x.id === questionId);
    if (!q || q.run?.requestId !== requestId) return undefined;
    return { questions: current.questions.map((x) => x.id === questionId
      ? { ...x, run: { ...x.run, status, finishedAt: done() } } : x) };
  });
}

export async function executeAnswerWork({ jobId, questionId, requestId, fingerprint, model }) {
  const wanted = resolveModel(model);
  const job = await getJob(jobId);
  if (!job) throw Object.assign(new Error("Job not found"), { status: 404, abort: true });
  const report = job.fitReportId ? await getReport(job.fitReportId) : null;
  const question = (job.questions || []).find((q) => q.id === questionId);
  if (!question) throw Object.assign(new Error("Question not found"), { status: 404, abort: true });
  if (question.run?.requestId !== requestId || answerFingerprint(job, questionId, wanted, report) !== fingerprint) {
    await mark(jobId, questionId, requestId, "superseded");
    return { outcome: "superseded", jobId, questionId, requestId };
  }
  let result = await getTaskResult("answer", jobId, requestId);
  if (!result) {
    const index = job.questions.indexOf(question);
    const previous = job.questions.slice(0, index).filter((q) => q.a && !q.refused).map((q) => ({ q: q.q, a: q.a }));
    result = await saveTaskResult("answer", jobId, requestId, await runAnswer({
      question: question.q, limit: question.limit, report, jobDescription: job.jobDescription,
      previous, instructions: job.instructions, model: wanted, ref: requestId,
    }));
  }
  const latest = await getJob(jobId);
  const latestReport = latest?.fitReportId ? await getReport(latest.fitReportId) : null;
  if (!latest || answerFingerprint(latest, questionId, wanted, latestReport) !== fingerprint) {
    await mark(jobId, questionId, requestId, "superseded");
    return { outcome: "superseded", jobId, questionId, requestId };
  }
  const reportRevision = latest.fitReportId ? await getReportRevision(latest.fitReportId) : 0;
  try {
    await mutateJob(jobId, (current) => {
      const q = (current.questions || []).find((x) => x.id === questionId);
      if (!q || q.run?.requestId !== requestId || q.run?.fingerprint !== fingerprint) return undefined;
      return {
        briefFingerprint: "",
        questions: current.questions.map((x) => x.id === questionId ? {
          ...x, a: result.answer, refused: result.refused, reason: result.reason, answeredAt: result.answeredAt,
          run: { ...x.run, status: "completed", finishedAt: done() },
        } : x),
      };
    }, latest.fitReportId ? { expectedReportRevision: { id: latest.fitReportId, revision: reportRevision } } : {});
  } catch (error) {
    if (error?.code !== "REPORT_CHANGED") throw error;
    await mark(jobId, questionId, requestId, "superseded");
    return { outcome: "superseded", jobId, questionId, requestId };
  }
  return { outcome: "completed", jobId, questionId, requestId, refused: result.refused,
    words: result.words, limit: result.limit, over: result.over, model: wanted };
}
