// Pipeline insights: how roles move through the stages, where they drop out, how
// long each stage takes and what changed recently. Everything is derived from the
// job records, their recorded audit events and the Filtered records; nothing new
// is stored. See docs/pipeline-insights.md.
import { listJobs } from "./store.js";
import { readJobEvents } from "./job-audit.js";
import { listFilteredDates, filteredJobRetentionDays, countFilteredJobs } from "./filtered-jobs.js";

export const FLOW_STAGES = ["new", "reviewing", "applied", "interviewing", "offer"];
// Ways out of the flow. "archived" is a role archived by hand while still active.
export const DROP_KINDS = ["rejected", "not_interested", "expired", "archived"];
export const RANGES = { "7": 7, "14": 14, "30": 30, "90": 90 };
export const DEFAULT_RANGE = "30";
const ACTIVITY_DAYS = 30;
const ACTIVITY_LIMIT = 40;
const WAITING_LIMIT = 6;
const DAY = 86400000;
const EVENT_TYPES = ["job.created", "status.changed", "agent.moved", "interview.added"];
export const STAGE_LABELS = { new: "New", reviewing: "Reviewing", applied: "Applied", interviewing: "Interviewing",
  offer: "Offer", rejected: "Rejected", not_interested: "Not interested", expired: "Expired", archived: "Archived" };

// Audit details read "applied → interviewing", with underscores shown as spaces.
const stageFromLabel = text => {
  const stage = String(text || "").trim().toLowerCase().replace(/\s+/g, "_");
  return stage === "not_a_fit" ? "not_interested" : stage;
};
export function parseStageChange(detail) {
  const [from, to] = String(detail || "").split("→").map(stageFromLabel);
  return from && to && from !== to ? { from, to } : null;
}

const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const inDays = ms => ms == null ? null : Math.round(ms / DAY * 10) / 10;
const ratio = (part, whole) => whole ? part / whole : null;

// One role's journey. A role whose audit began with it (not legacy) has its whole
// stage history recorded; for older roles only later changes are known. A legacy
// role that closed before any change was recorded has its last open stage
// inferred from where it ended, and is counted as inferred.
export function stageHistory(job, events = []) {
  const changes = events.filter(e => e.type === "status.changed")
    .map(e => ({ ...parseStageChange(e.detail), at: e.at })).filter(c => c.from && c.to);
  const complete = !!job.auditStartedAt && !job.auditLegacy;
  const initial = changes.length ? changes[0].from : job.stage;
  const entries = [{ stage: initial, at: complete ? job.createdAt : null },
    ...changes.map(c => ({ stage: c.to, at: c.at }))];
  let furthest = Math.max(...entries.map(e => FLOW_STAGES.indexOf(e.stage)));
  const closed = DROP_KINDS.includes(job.stage);
  const inferred = closed && !changes.length && !complete;
  if (inferred) furthest = job.stage === "rejected" ? ((job.interviewTimeline || []).length ? 3 : 2) : 0;
  if (furthest < 0) furthest = 0;
  const outcome = closed ? job.stage : job.archived ? "archived" : null;
  const durations = {};
  entries.forEach((entry, i) => {
    const next = entries[i + 1];
    const start = Date.parse(entry.at), end = next && Date.parse(next.at);
    if (next && FLOW_STAGES.includes(entry.stage) && Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      (durations[entry.stage] ||= []).push(end - start);
    }
  });
  const applied = entries.find(e => e.stage === "applied" && e.at);
  const last = entries[entries.length - 1];
  return { entries, furthest, outcome, inferred, durations,
    appliedAt: applied ? applied.at : null,
    currentSince: last.stage === job.stage && last.at ? last.at : null };
}

export function sourceGroup(job) {
  const text = `${job.source || ""} ${job.sourceType || ""}`.toLowerCase();
  if (text.includes("linkedin")) return "LinkedIn";
  if (job.sourceType === "job-board") return "Job boards";
  if (job.sourceType === "website") return "Fit website";
  if (/\bemail\b|recruiter|gmail/.test(text) || job.threadId) return "Email";
  return "Other";
}

// The intake chart has one bar per day for ranges of two weeks or less, and one
// per week (4 to 26) for longer ones, the current day or week last.
export function weekWindow(nowMs, days) {
  if (days && days <= 14) return { count: days, first: dayStart(nowMs) - (days - 1) * DAY, step: DAY };
  const count = Math.min(26, Math.max(4, Math.ceil((days || 182) / 7)));
  return { count, first: weekStart(nowMs) - (count - 1) * 7 * DAY, step: 7 * DAY };
}

function dayStart(ms) {
  const date = new Date(ms);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function weekStart(ms) {
  const date = new Date(ms);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.getTime();
}

function flowGraph(discovered, screened, reached, dropped, still) {
  const columns = ["Discovered", ...FLOW_STAGES.map(s => STAGE_LABELS[s])];
  const nodes = [{ id: "discovered", column: 0, label: "Discovered", kind: "source", value: discovered }];
  const links = [];
  if (screened) {
    nodes.push({ id: "screened", column: 1, label: "Screened out", kind: "drop", value: screened, breakdown: { screened } });
    links.push({ source: "discovered", target: "screened", value: screened });
  }
  FLOW_STAGES.forEach((stage, i) => {
    nodes.push({ id: stage, column: i + 1, label: STAGE_LABELS[stage], kind: "stage", stage, value: reached[i], still: still[i] });
    links.push({ source: i ? FLOW_STAGES[i - 1] : "discovered", target: stage, value: reached[i] });
    const breakdown = dropped[i], total = DROP_KINDS.reduce((sum, kind) => sum + breakdown[kind], 0);
    if (!total) return;
    if (i + 2 >= columns.length) columns.push("Closed");
    nodes.push({ id: `drop-${stage}`, column: i + 2, label: "Dropped", kind: "drop", value: total,
      breakdown: Object.fromEntries(DROP_KINDS.filter(kind => breakdown[kind]).map(kind => [kind, breakdown[kind]])) });
    links.push({ source: stage, target: `drop-${stage}`, value: total });
  });
  return { columns, nodes: nodes.filter(n => n.value > 0 || n.kind !== "drop"), links: links.filter(l => l.value > 0) };
}

export function buildPipelineOverview({ jobs = [], events = {}, filtered = [], now = new Date(), days = 90 }) {
  const nowMs = now.getTime();
  const since = days ? nowMs - days * DAY : null;
  const within = (iso, from, to = nowMs) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && (from == null || t >= from) && t <= to;
  };
  const histories = new Map(jobs.map(job => [job.id, stageHistory(job, events[job.id] || [])]));
  const cohort = jobs.filter(job => within(job.createdAt, since));
  const screened = filtered.filter(f => within(f.at, since));

  const reached = FLOW_STAGES.map(() => 0), still = FLOW_STAGES.map(() => 0);
  const dropped = FLOW_STAGES.map(() => Object.fromEntries(DROP_KINDS.map(kind => [kind, 0])));
  const durations = Object.fromEntries(FLOW_STAGES.map(s => [s, []]));
  const scores = FLOW_STAGES.map(() => []);
  const toApply = [];
  let inferred = 0;
  for (const job of cohort) {
    const h = histories.get(job.id);
    if (h.inferred) inferred++;
    for (let i = 0; i <= h.furthest; i++) {
      reached[i]++;
      if (Number.isFinite(job.score)) scores[i].push(job.score);
    }
    if (h.outcome) dropped[h.furthest][h.outcome]++;
    else still[h.furthest]++;
    for (const [stage, list] of Object.entries(h.durations)) durations[stage].push(...list);
    if (h.appliedAt) toApply.push(Date.parse(h.appliedAt) - Date.parse(job.createdAt));
  }

  const stages = FLOW_STAGES.map((stage, i) => {
    const before = i ? reached[i - 1] : cohort.length + screened.length;
    const drops = dropped[i];
    return { id: stage, label: STAGE_LABELS[stage], reached: reached[i], conversion: ratio(reached[i], before),
      dropped: DROP_KINDS.reduce((sum, kind) => sum + drops[kind], 0),
      droppedBy: Object.fromEntries(DROP_KINDS.filter(kind => drops[kind]).map(kind => [kind, drops[kind]])),
      still: still[i], medianDays: inDays(median(durations[stage])),
      timedRoles: durations[stage].length, medianScore: median(scores[i]) == null ? null : Math.round(median(scores[i])) };
  });

  const active = jobs.filter(job => !job.archived);
  const previous = since == null ? null : jobs.filter(job => within(job.createdAt, since - days * DAY, since - 1)).length;
  const kpis = {
    added: cohort.length, addedPrevious: previous,
    screenedOut: screened.length, screenedRate: ratio(screened.length, screened.length + cohort.length),
    applied: reached[2], applicationRate: ratio(reached[2], reached[0]),
    interviews: reached[3], interviewRate: ratio(reached[3], reached[2]),
    offers: reached[4],
    medianDaysToApply: inDays(median(toApply)), timedApplications: toApply.length,
    active: active.length,
    activeByStage: Object.fromEntries(FLOW_STAGES.map(stage => [stage, active.filter(job => job.stage === stage).length])),
  };

  const { count: weekCount, first: firstWeek, step } = weekWindow(nowMs, days);
  const weekly = Array.from({ length: weekCount }, (_, i) => ({ weekStart: new Date(firstWeek + i * step).toISOString().slice(0, 10), added: 0, screened: 0, applied: 0 }));
  const bucket = iso => {
    const t = Date.parse(iso);
    if (!Number.isFinite(t) || t < firstWeek || t > nowMs) return null;
    return weekly[Math.floor((t - firstWeek) / step)] || null;
  };
  for (const job of jobs) {
    const week = bucket(job.createdAt);
    if (week) week.added++;
    for (const event of events[job.id] || []) {
      const change = event.type === "status.changed" && parseStageChange(event.detail);
      const target = change && change.to === "applied" && bucket(event.at);
      if (target) target.applied++;
    }
  }
  for (const f of filtered) { const week = bucket(f.at); if (week) week.screened++; }

  const sourceRows = new Map();
  for (const job of cohort) {
    const h = histories.get(job.id), name = sourceGroup(job);
    const row = sourceRows.get(name) || { source: name, added: 0, reviewing: 0, applied: 0, interviewing: 0 };
    row.added++;
    if (h.furthest >= 1) row.reviewing++;
    if (h.furthest >= 2) row.applied++;
    if (h.furthest >= 3) row.interviewing++;
    sourceRows.set(name, row);
  }
  const sources = [...sourceRows.values()].sort((a, b) => b.added - a.added || a.source.localeCompare(b.source));

  // Open roles that have sat longest in their current stage (New is the review
  // queue's job, so it is left out). Only recorded entry dates are used.
  const waiting = active.filter(job => FLOW_STAGES.indexOf(job.stage) >= 1)
    .map(job => ({ job, since: histories.get(job.id).currentSince }))
    .filter(row => row.since)
    .map(({ job, since: at }) => ({ id: job.id, company: job.company || "", role: job.role || "", stage: job.stage,
      score: Number.isFinite(job.score) ? job.score : null, since: at, days: Math.floor((nowMs - Date.parse(at)) / DAY) }))
    .sort((a, b) => b.days - a.days).slice(0, WAITING_LIMIT);

  const activityFrom = nowMs - ACTIVITY_DAYS * DAY;
  const activity = [];
  for (const job of jobs) {
    const list = events[job.id] || [];
    const agentRevisions = new Set(list.filter(e => e.type === "agent.moved").map(e => String(e.id).replace(/-\d+$/, "")));
    for (const event of list) {
      if (!within(event.at, activityFrom)) continue;
      const base = { id: `${job.id}:${event.id}`, jobId: job.id, company: job.company || "", role: job.role || "",
        stage: job.stage, archived: !!job.archived, at: event.at };
      if (event.type === "job.created" && event.id !== "legacy-creation") activity.push({ ...base, kind: "added", source: sourceGroup(job) });
      else if (event.type === "status.changed") {
        const change = parseStageChange(event.detail);
        if (change) activity.push({ ...base, kind: "stage", from: change.from, to: change.to,
          byAgent: agentRevisions.has(String(event.id).replace(/-\d+$/, "")) });
      } else if (event.type === "interview.added") activity.push({ ...base, kind: "interview", detail: String(event.detail || "").slice(0, 120) });
    }
  }
  activity.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return {
    since: since == null ? null : new Date(since).toISOString(), generatedAt: now.toISOString(),
    flow: flowGraph(cohort.length + screened.length, screened.length, reached, dropped, still),
    stages, kpis, weekly, intakeDays: step / DAY, sources, waiting, inferred,
    activity: activity.slice(0, ACTIVITY_LIMIT), activityDays: ACTIVITY_DAYS,
  };
}

export async function pipelineOverviewResponse(query = {}, { now = new Date() } = {}) {
  const range = Object.hasOwn(RANGES, String(query.range)) ? String(query.range) : DEFAULT_RANGE;
  const days = RANGES[range];
  const since = days ? now.getTime() - days * DAY : null;
  const jobs = await listJobs({ includeArchived: true });
  // Read history for the roles this view can show: the range's roles, open
  // roles (time in stage) and anything touched recently (activity).
  const earliest = since == null ? null : Math.min(since, weekWindow(now.getTime(), days).first, now.getTime() - ACTIVITY_DAYS * DAY);
  const ids = jobs.filter(job => earliest == null || !job.archived || Date.parse(job.createdAt) >= earliest ||
    Date.parse(job.updatedAt) >= earliest).map(job => job.id);
  const [events, filtered, filteredCount] = await Promise.all([
    readJobEvents(ids, EVENT_TYPES),
    listFilteredDates(earliest == null ? null : new Date(earliest).toISOString()),
    countFilteredJobs().catch(() => null),
  ]);
  let retentionDays = null;
  try { retentionDays = filteredJobRetentionDays(); } catch { retentionDays = null; }
  // Current sizes of the Jobs view's tabs, so the dashboard can link straight to them.
  const counts = { active: jobs.filter(job => !job.archived).length, archived: jobs.filter(job => job.archived).length, filtered: filteredCount };
  return { range, ranges: Object.keys(RANGES), retentionDays, counts, ...buildPipelineOverview({ jobs, events, filtered, now, days }) };
}
