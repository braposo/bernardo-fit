// Pure helpers for the desktop Pipeline board. The browser imports this file
// directly (like admin-run.js), and tests/test-pipeline-board.mjs covers it.
// "Ready to apply" is derived for display only: no stage is stored or changed.

export const BOARD_COLUMNS = [
  { id: "new", label: "New" },
  { id: "reviewing", label: "Reviewing" },
  { id: "ready", label: "Ready to apply" },
  { id: "applied", label: "Applied" },
  { id: "interviewing", label: "Interviewing" },
  { id: "offer", label: "Offer" },
];

const RUNNING = ["dispatching", "queued", "running"];
const isRunning = run => !!(run && run.runId && RUNNING.includes(run.status));

// A tailored CV exists once one is live or has a fit page link (the same test the
// Materials tab uses for its "Live" state).
function hasTailoredCv(job) {
  const cv = job.applicationCv || {};
  return !!(cv.currentVersionId || cv.downloadUrl || cv.fitUrl);
}

// Application answers count as done when every application question is answered
// or refused. A job with no application questions needs none.
function answersComplete(job) {
  const total = Number.isFinite(job.questionCount) ? job.questionCount : (job.questions || []).length;
  if (!total) return true;
  const done = Number.isFinite(job.answeredCount) ? job.answeredCount
    : (job.questions || []).filter(q => q.a || q.refused).length;
  return done >= total;
}

// The posting check's drafted form answers (docs/posting-check.md) must be approved
// or skipped. A job with no check, or a check with no form questions, needs none.
function postingAnswersReady(job) {
  const questions = job.postingCheck && job.postingCheck.form && job.postingCheck.form.questions;
  if (!Array.isArray(questions)) return true;
  return questions.every(question => question.state !== "pending" && question.state !== "drafted");
}

export function isReadyToApply(job) {
  return !!job && job.stage === "reviewing" && !!job.fitReportId && hasTailoredCv(job) && answersComplete(job) && postingAnswersReady(job);
}

// The board column a job belongs in, or null for stages the board does not show.
export function boardColumnId(job) {
  if (!job) return null;
  if (isReadyToApply(job)) return "ready";
  return BOARD_COLUMNS.some(c => c.id === job.stage && c.id !== "ready") ? job.stage : null;
}

// Buckets jobs by column, keeping the incoming order inside each column.
export function groupByColumn(jobs) {
  const groups = Object.fromEntries(BOARD_COLUMNS.map(c => [c.id, []]));
  for (const job of jobs || []) {
    const id = boardColumnId(job);
    if (id) groups[id].push(job);
  }
  return groups;
}

const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

// One short line on what the system is doing for a column, or "" when idle.
export function columnActivity(jobs) {
  const count = pick => (jobs || []).filter(job => pick(job)).length;
  const cvRun = job => (job.applicationCv && job.applicationCv.run) || job.cvRun;
  const parts = [
    [count(job => isRunning(job.jevRun)), n => plural(n, "assessment running", "assessments running")],
    [count(job => isRunning(cvRun(job)) || isRunning(job.applicationRun) || isRunning(job.analysisRun)),
      n => plural(n, "CV generating", "CVs generating")],
    [count(job => isRunning(job.coverRun)), n => plural(n, "letter generating", "letters generating")],
    [count(job => isRunning(job.researchRun)), n => plural(n, "research running", "research runs running")],
    [count(job => isRunning(job.prepareRun) || isRunning(job.briefRun)), n => plural(n, "prep running", "preps running")],
  ];
  return parts.filter(([n]) => n > 0).map(([n, text]) => text(n)).join(" · ");
}
