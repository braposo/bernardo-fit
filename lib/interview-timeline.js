// The interview timeline on a job: one dated entry per round, added when
// Bernardo applies an email status proposal that carries an interview, or by
// hand. Stored with the job's runtime fields as `interviewTimeline`. Notes are
// private, like the job's notes, and the interview brief reads them.
import { randomUUID } from "node:crypto";

export const TIMELINE_KINDS = ["phone", "video", "onsite", "assessment", "other"];
export const TIMELINE_SOURCES = ["email", "manual"];
export const MAX_TIMELINE_ENTRIES = 40;
export const TIMELINE_ROUND_MAX_LENGTH = 80;
export const TIMELINE_NOTES_MAX_LENGTH = 4000;

const badRequest = message => Object.assign(new Error(message), { status: 400 });
// A calendar date, or a date and time with an optional zone: 2026-11-03,
// 2026-11-03T14:00, 2026-11-03T14:00:00Z, 2026-11-03T14:00+01:00.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

export function validDate(value) {
  return typeof value === "string" && DATE_PATTERN.test(value) && Number.isFinite(Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value));
}

function text(value, max, label, { required = false } = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw badRequest(`The ${label} must be text.`);
  const clean = value.trim();
  if (required && !clean) throw badRequest(`The ${label} is required.`);
  if (clean.length > max) throw badRequest(`The ${label} must be ${max} characters or fewer.`);
  return clean;
}

// The interview fields shared by proposals and timeline entries.
// partial: only the fields present are checked and returned (for edits).
export function validateInterviewFields(value, { partial = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest("The interview must be an object with a date, round and kind.");
  const out = {};
  if (!partial || value.date !== undefined) {
    if (!validDate(value.date)) throw badRequest("The interview date must be an ISO date such as 2026-11-03 or 2026-11-03T14:00:00Z.");
    out.date = value.date;
  }
  if (!partial || value.round !== undefined) out.round = text(value.round, TIMELINE_ROUND_MAX_LENGTH, "interview round", { required: true });
  if (!partial || value.kind !== undefined) {
    const kind = value.kind ?? "other";
    if (!TIMELINE_KINDS.includes(kind)) throw badRequest(`The interview kind must be one of ${TIMELINE_KINDS.join(", ")}.`);
    out.kind = kind;
  }
  if (!partial || value.notes !== undefined) out.notes = text(value.notes, TIMELINE_NOTES_MAX_LENGTH, "interview notes");
  return out;
}

// Stored entries as the admin sees them, oldest first. Anything malformed is dropped.
export function timelineView(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter(entry => entry && typeof entry.id === "string" && validDate(entry.date))
    .map(entry => ({ id: entry.id, date: entry.date, round: String(entry.round || ""),
      kind: TIMELINE_KINDS.includes(entry.kind) ? entry.kind : "other",
      source: TIMELINE_SOURCES.includes(entry.source) ? entry.source : "manual",
      notes: String(entry.notes || ""), proposalId: String(entry.proposalId || ""),
      createdAt: String(entry.createdAt || ""), updatedAt: String(entry.updatedAt || "") }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export function timelineEntry(fields, { source = "manual", proposalId = "", now = new Date(), id = randomUUID() } = {}) {
  const at = now.toISOString();
  return { id, ...validateInterviewFields(fields), source, proposalId, createdAt: at, updatedAt: at };
}

// mutateJob patches. Each takes the current job and returns the fields to
// write, or undefined for no change, so a retried write never duplicates.
// Editing notes invalidates the interview brief, as a job notes edit does.
export function addTimelineEntry(current, entry) {
  const entries = timelineView(current.interviewTimeline);
  if (entries.some(e => e.id === entry.id || (entry.proposalId && e.proposalId === entry.proposalId))) return undefined;
  if (entries.length >= MAX_TIMELINE_ENTRIES) throw badRequest(`A job keeps at most ${MAX_TIMELINE_ENTRIES} interview entries.`);
  return { interviewTimeline: timelineView([...entries, entry]), ...(entry.notes ? { briefFingerprint: "" } : {}) };
}

export function editTimelineEntry(current, entryId, fields, { now = new Date() } = {}) {
  const entries = timelineView(current.interviewTimeline);
  const index = entries.findIndex(e => e.id === entryId);
  if (index === -1) throw Object.assign(new Error("Interview entry not found."), { status: 404 });
  const changes = validateInterviewFields(fields, { partial: true });
  if (!Object.keys(changes).length) throw badRequest("Send at least one of date, round, kind or notes.");
  const next = { ...entries[index], ...changes, updatedAt: now.toISOString() };
  entries[index] = next;
  return { interviewTimeline: timelineView(entries), briefFingerprint: "" };
}

export function removeTimelineEntry(current, entryId) {
  const entries = timelineView(current.interviewTimeline);
  if (!entries.some(e => e.id === entryId)) throw Object.assign(new Error("Interview entry not found."), { status: 404 });
  return { interviewTimeline: entries.filter(e => e.id !== entryId), briefFingerprint: "" };
}

// What the interview brief reads: dated rounds with their notes, no internal ids.
export function timelineBriefInput(entries) {
  return timelineView(entries).map(({ date, round, kind, notes }) => ({ date, round, kind, notes: notes.slice(0, 1500) }));
}
