import { requireAdmin } from "../_admin.js";
import { runAnswer } from "../_answer.js";
import { getJob, updateJob, getReport } from "../_store.js";

// POST /api/admin/answer  { id, questionId }
//
// Drafts an answer to one question on a job's application form and saves it
// back onto the row. One question at a time, so each can be read before the
// next is spent on.
export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { id, questionId } = req.body || {};
  if (!id || !questionId) {
    res.status(400).json({ error: "Missing id or questionId" });
    return;
  }

  try {
    const job = await getJob(id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const questions = Array.isArray(job.questions) ? job.questions : [];
    const target = questions.find((q) => q.id === questionId);
    if (!target) {
      res.status(404).json({ error: "Question not found" });
      return;
    }
    if (!String(target.q || "").trim()) {
      res.status(400).json({ error: "Write the question first." });
      return;
    }

    // The fit analysis is optional here. Unlike the cover letter, a form answer
    // can stand on the profile and the posting alone, and questions often turn
    // up before an analysis has been run.
    const report = job.fitReportId ? await getReport(job.fitReportId) : null;

    // Only answers that already exist, and only the ones before this question,
    // so re-answering one in the middle does not read the ones after it.
    const upTo = questions.slice(0, questions.indexOf(target));
    const previous = upTo.filter((q) => q.a && !q.refused).map((q) => ({ q: q.q, a: q.a }));

    const out = await runAnswer({
      question: target.q,
      limit: target.limit,
      report,
      jobDescription: job.jobDescription,
      previous,
      instructions: (job.instructions || "").trim(),
    });

    const next = questions.map((q) =>
      q.id === questionId
        ? { ...q, a: out.answer, refused: out.refused, reason: out.reason, answeredAt: out.answeredAt }
        : q
    );
    await updateJob(id, { questions: next });

    res.status(200).json({
      ok: true,
      questionId,
      answer: out.answer,
      refused: out.refused,
      reason: out.reason,
      words: out.words,
      limit: out.limit,
      over: out.over,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Unexpected error", detail: err.detail });
  }
}
