import { randomUUID } from "node:crypto";
import { hasKV, kv } from "./kv.js";

// Append-only, private event streams. No viewer identifiers or document bodies.
// Job/report state writers append through their own atomic compare-and-set.
const memory = new Map();
// Match Redis's descending member ordering for events sharing a millisecond.
const newestFirst = (a, b) => Date.parse(b.at) - Date.parse(a.at) ||
  (JSON.stringify(a) > JSON.stringify(b) ? -1 : JSON.stringify(a) < JSON.stringify(b) ? 1 : 0);
export const auditKey = (scope, id) => `audit:${scope}:${id}`;
export function auditEvent(type, title, detail = "", options = {}) {
  const at = Number.isFinite(Date.parse(options.at)) ? new Date(options.at).toISOString() : new Date().toISOString();
  return { id: options.id || randomUUID(), at, timestamp: Date.parse(at),
    type, title, detail, actor: options.actor || "system" };
}
export function appendMemoryAudit(key, events) {
  const entries = memory.get(key) || new Map();
  for (const event of events) if (!entries.has(event.id)) entries.set(event.id, structuredClone(event));
  memory.set(key, entries);
}
export async function appendAudit(scope, id, event) {
  const key = auditKey(scope, id);
  if (hasKV) await (await kv()).zadd(key, { nx: true }, { score: Date.parse(event.at), member: JSON.stringify(event) });
  else appendMemoryAudit(key, [event]);
}

const label = value => String(value || "none").replaceAll("_", " ");
export function jobMutationEvents(before, after, revision) {
  const events = [];
  const add = (type, title, detail, actor) => events.push(auditEvent(type, title, detail,
    { id: `revision-${revision}-${events.length}`, actor }));
  if (!before) { add("job.created", "Added to pipeline", after?.source ? `Source: ${after.source}` : ""); return events; }
  if (!after) { add("job.deleted", "Job deleted"); return events; }
  if (before.stage !== after.stage) add("status.changed", "Status changed", `${label(before.stage)} → ${label(after.stage)}`);
  if (before.archived !== after.archived) add("job.archived", after.archived ? "Archived" : "Restored to pipeline");
  const fields = ["company", "role", "source", "sourceType", "externalId", "threadId", "sourceUrl", "location", "locationMode", "salary", "jobDescription", "notes", "instructions", "recruiter", "closed", "replyOwed", "userViewed", "score", "tier", "scoreBreakdown", "rationale", "receivedAt"];
  const changed = fields.filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  if (changed.length) add("job.updated", "Job details updated", changed.map(key => key.replace(/([A-Z])/g, " $1").toLowerCase()).join(", "));
  if (before.fitReportId !== after.fitReportId) add("fit.linked", after.fitReportId ? "Fit analysis linked" : "Fit analysis unlinked", after.fitReportId || "");
  for (const [field, title, model] of [["coverLetterId", "Cover letter", "coverLetterModel"], ["researchId", "Company research", "researchModel"], ["briefId", "Interview brief", "briefModel"]]) {
    if (before[field] !== after[field]) add("document.published", `${title} ${after[field] ? "published live" : "removed"}`, [after[field], after[model]].filter(Boolean).join(" · "));
  }
  for (const [field, title] of [["jevRun", "Fit assessment"], ["applicationRun", "Application"], ["analysisRun", "Fit analysis"], ["coverRun", "Cover letter"], ["researchRun", "Company research"], ["briefRun", "Interview brief"], ["prepareRun", "Interview preparation"]]) {
    const prev = before[field], next = after[field];
    if (next && (prev?.status !== next.status || prev?.requestId !== next.requestId)) add("generation." + next.status, `${title}: ${label(next.status)}`, [next.model, next.runId].filter(Boolean).join(" · "));
  }
  if (after.agentReview?.reviewedAt && after.agentReview.reviewedAt !== before.agentReview?.reviewedAt)
    add("agent.reviewed", "Review agent suggestion", after.agentReview.lean === "ask" ? "Ask" : after.agentReview.lean === "advance" ? "Move forward" : "Drop");
  // The review agent's automatic move, and Bernardo undoing it.
  const move = after.agentReview?.autoMove;
  if (move?.at && move.at !== before.agentReview?.autoMove?.at)
    add("agent.moved", "Moved by the review agent", `${label(before.stage || "new")} → ${label(move.stage)}`, "agent");
  if (move?.overriddenAt && move.overriddenAt !== before.agentReview?.autoMove?.overriddenAt)
    add("agent.overridden", "Review agent's move undone", `${label(before.stage)} → ${label(after.stage)}${before.archived && !after.archived ? ", restored" : ""}`, "admin");
  const oldInterviews = new Map((before.interviewTimeline || []).map(entry => [entry.id, entry]));
  for (const entry of after.interviewTimeline || []) {
    const old = oldInterviews.get(entry.id);
    if (!old) add("interview.added", entry.source === "email" ? "Interview added from email" : "Interview added", [entry.round, entry.date].filter(Boolean).join(" · "));
    else if (JSON.stringify(old) !== JSON.stringify(entry)) add("interview.updated", "Interview updated", [entry.round, entry.date].filter(Boolean).join(" · "));
    oldInterviews.delete(entry.id);
  }
  for (const entry of oldInterviews.values()) add("interview.removed", "Interview removed", [entry.round, entry.date].filter(Boolean).join(" · "));
  const oldQuestions = new Map((before.questions || []).map(q => [q.id, q]));
  for (const q of after.questions || []) {
    const old = oldQuestions.get(q.id);
    if (!old) add("question.created", "Application question added");
    else if (old.q !== q.q || old.limit !== q.limit) add("question.updated", "Application question updated");
    if (q.answeredAt && q.answeredAt !== old?.answeredAt) add("answer.generated", "Application answer generated", q.model || "");
    if (q.run && (q.run.status !== old?.run?.status || q.run.requestId !== old?.run?.requestId)) add("answer." + q.run.status, `Application answer: ${label(q.run.status)}`, q.run.model || "");
    oldQuestions.delete(q.id);
  }
  for (const q of oldQuestions.values()) add("question.deleted", "Application question removed");
  return events;
}

async function readStream(key, snapshot, limit) {
  if (hasKV) {
    const rows = await (await kv()).zrange(key, snapshot, "-inf", { byScore: true, rev: true, offset: 0, count: limit });
    return rows.map(row => typeof row === "string" ? JSON.parse(row) : row);
  }
  return [...(memory.get(key)?.values() || [])].filter(e => Date.parse(e.at) <= snapshot)
    .sort(newestFirst).slice(0, limit);
}

export async function getJobAudit(job, { offset = 0, snapshot = Date.now(), limit = 50, evidence = [] } = {}) {
  const reportIds = [...new Set([...(job.auditReportIds || []), job.fitReportId].filter(Boolean))];
  const streams = await Promise.all([auditKey("job", job.id), ...reportIds.map(id => auditKey("report", id))]
    .map(key => readStream(key, snapshot, offset + limit + 1)));
  const rows = streams.flat();
  // Prefer recorded events; version/run evidence fills gaps, never duplicates
  // existing generation entries. Two answers with the same model are distinct.
  const matches = (a, b) => a.id === b.id || (a.type === b.type && a.title === b.title && a.detail === b.detail &&
    (a.type === "document.generated" || a.type.startsWith("generation.") || Math.abs(Date.parse(a.at) - Date.parse(b.at)) < 1000));
  for (const event of evidence) if (!rows.some(row => matches(row, event))) rows.push(event);
  // Existing creation dates are evidence; pre-audit status/view histories are not.
  if (!job.auditStartedAt) rows.push(auditEvent("job.created", "Added to pipeline", "From the saved creation date", { id: "legacy-creation", at: job.createdAt }));
  const events = rows.filter(e => Date.parse(e.at) <= snapshot).sort(newestFirst);
  return { events: events.slice(offset, offset + limit), hasMore: events.length > offset + limit, snapshot,
    historyNote: job.auditLegacy || !job.auditStartedAt ? "Earlier actions were not recorded individually. Analytics totals may include activity before this audit log began." : "" };
}
