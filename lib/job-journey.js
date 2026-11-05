// One role's stage timeline for its Overview: when it was added, how long it
// spent in each stage, when it was last moved to Applied and where it is now.
// Derived from the same recorded audit events as the Dashboard (see
// lib/pipeline-overview.js); nothing new is stored. Roles whose audit began
// after they were added ("legacy") only have later changes; their earlier
// stages are shown without dates rather than guessed.
import { readJobEvents } from "./job-audit.js";
import { stageHistory, parseStageChange, sourceGroup, DROP_KINDS } from "./pipeline-overview.js";

const DAY = 86400000;
export const JOURNEY_EVENT_TYPES = ["status.changed", "agent.moved", "job.archived"];
const days = ms => Number.isFinite(ms) && ms >= 0 ? Math.round(ms / DAY * 10) / 10 : null;
const revision = id => String(id || "").replace(/-\d+$/, "");

export function jobJourney(job, events = [], now = new Date()) {
  const nowMs = now.getTime();
  const history = stageHistory(job, events);
  const complete = !!job.auditStartedAt && !job.auditLegacy;
  const agentRevisions = new Set(events.filter(e => e.type === "agent.moved").map(e => revision(e.id)));
  const changes = events.filter(e => e.type === "status.changed" && parseStageChange(e.detail));
  // Archived by hand while still open: the timeline stops there.
  const closed = DROP_KINDS.includes(job.stage);
  const lastArchive = [...events].reverse().find(e => e.type === "job.archived");
  const archivedAt = job.archived && !closed && lastArchive && /^archived/i.test(lastArchive.title || "Archived") ? lastArchive.at : null;

  const stages = history.entries.map((entry, i) => {
    const next = history.entries[i + 1];
    const last = !next;
    const ends = DROP_KINDS.includes(entry.stage);
    const from = entry.at || null;
    const to = next ? next.at || null : archivedAt;
    const current = last && !ends && !archivedAt && !job.archived;
    const start = Date.parse(from);
    const end = to ? Date.parse(to) : current ? nowMs : NaN;
    const change = i ? changes[i - 1] : null;
    return { stage: entry.stage, from, to: ends ? null : to, current, closed: ends,
      days: ends ? null : days(end - start), byAgent: !!(change && agentRevisions.has(revision(change.id))) };
  });
  if (archivedAt) stages.push({ stage: "archived", from: archivedAt, to: null, current: false, closed: true, days: null, byAgent: false });

  const appliedMoves = changes.map(e => ({ ...parseStageChange(e.detail), at: e.at })).filter(c => c.to === "applied");
  const lastApplied = appliedMoves.length ? appliedMoves[appliedMoves.length - 1].at : null;
  const firstApplied = appliedMoves.length ? appliedMoves[0].at : null;
  const created = Date.parse(job.createdAt);
  const endMs = (() => {
    const final = stages[stages.length - 1];
    return final && final.closed && final.from ? Date.parse(final.from) : nowMs;
  })();
  const current = stages.find(s => s.current) || null;
  return {
    addedAt: job.createdAt || null, source: sourceGroup(job),
    complete, historyFrom: complete ? null : job.auditStartedAt || null,
    stages,
    currentStage: current ? current.stage : null, currentSince: current ? current.from : null, currentDays: current ? current.days : null,
    appliedAt: lastApplied, appliedTimes: appliedMoves.length,
    daysToApply: firstApplied && Number.isFinite(created) ? days(Date.parse(firstApplied) - created) : null,
    totalDays: Number.isFinite(created) ? days(endMs - created) : null,
    open: !stages.some(s => s.closed),
    generatedAt: now.toISOString(),
  };
}

export async function jobJourneyResponse(job, { now = new Date() } = {}) {
  const events = (await readJobEvents([job.id], JOURNEY_EVENT_TYPES))[job.id] || [];
  return { stage: job.stage, archived: !!job.archived, ...jobJourney(job, events, now) };
}
