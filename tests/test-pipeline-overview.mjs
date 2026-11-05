import { buildPipelineOverview, stageHistory, parseStageChange, sourceGroup, pipelineOverviewResponse } from "../lib/pipeline-overview.js";
import { saveJob, updateJob } from "../lib/store.js";
import { recordFilteredJob } from "../lib/filtered-jobs.js";
import jobsHandler from "../api/admin/jobs.js";

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (e !== undefined ? " -> " + JSON.stringify(e) : "")); } };

const now = new Date("2026-11-04T12:00:00Z");
const daysAgo = d => new Date(now.getTime() - d * 86400000).toISOString();
const change = (from, to, d, id = "revision-1-0") => ({ type: "status.changed", detail: `${from} → ${to}`, at: daysAgo(d), id });
const job = (id, stage, created, extra = {}) => ({ id, company: "Co " + id, role: "Role " + id, stage, createdAt: daysAgo(created),
  auditStartedAt: daysAgo(created), auditLegacy: false, archived: ["rejected", "not_interested", "expired"].includes(stage), ...extra });

console.log("\n--- stage changes ---");
check("parses audit detail", JSON.stringify(parseStageChange("reviewing → not interested")) === JSON.stringify({ from: "reviewing", to: "not_interested" }));
check("legacy not a fit reads as not interested", parseStageChange("new → not a fit").to === "not_interested");
check("ignores unreadable detail", parseStageChange("Added") === null);

console.log("\n--- one role's journey ---");
const applied = stageHistory(job("a", "applied", 20), [change("new", "reviewing", 18), change("reviewing", "applied", 10)]);
check("furthest stage is applied", applied.furthest === 2, applied.furthest);
check("open role has no outcome", applied.outcome === null);
check("time in new is two days", Math.round(applied.durations.new[0] / 86400000) === 2);
check("time in reviewing is eight days", Math.round(applied.durations.reviewing[0] / 86400000) === 8);
check("current stage entered ten days ago", applied.currentSince === daysAgo(10));
const skipped = stageHistory(job("b", "rejected", 30), [change("new", "applied", 25), change("applied", "rejected", 5)]);
check("skipping reviewing still reaches applied", skipped.furthest === 2 && skipped.outcome === "rejected");
const legacy = stageHistory(job("c", "rejected", 60, { auditLegacy: true }), []);
check("legacy closed role without history is inferred", legacy.inferred && legacy.furthest === 2);
const legacyInterview = stageHistory(job("d", "rejected", 60, { auditLegacy: true, interviewTimeline: [{ id: "i" }] }), []);
check("legacy rejection after interviews is inferred at interviewing", legacyInterview.furthest === 3);
const legacyOpen = stageHistory(job("e", "applied", 60, { auditLegacy: true }), []);
check("legacy open role has no known entry date", legacyOpen.currentSince === null && !legacyOpen.inferred);
check("archived by hand counts as archived", stageHistory(job("f", "reviewing", 5, { archived: true }), [change("new", "reviewing", 4)]).outcome === "archived");

console.log("\n--- sources ---");
check("LinkedIn", sourceGroup({ source: "LinkedIn direct search", sourceType: "job-board" }) === "LinkedIn");
check("job boards", sourceGroup({ source: "Indeed via JSearch", sourceType: "job-board" }) === "Job boards");
check("email", sourceGroup({ source: "email", sourceType: "other" }) === "Email");
check("other", sourceGroup({ source: "manual", sourceType: "other" }) === "Other");

console.log("\n--- overview ---");
const jobs = [
  job("n1", "new", 3), job("n2", "not_interested", 8), job("r1", "reviewing", 12), job("a1", "applied", 20),
  job("i1", "interviewing", 40), job("x1", "rejected", 30), job("old", "applied", 200, { auditLegacy: true }),
];
const events = {
  n1: [{ type: "job.created", at: daysAgo(3), id: "revision-0-0" }],
  n2: [change("new", "not_interested", 6)],
  r1: [change("new", "reviewing", 11, "revision-2-0"), { type: "agent.moved", detail: "new → reviewing", at: daysAgo(11), id: "revision-2-1" }],
  a1: [change("new", "reviewing", 18), change("reviewing", "applied", 10)],
  i1: [change("new", "reviewing", 38), change("reviewing", "applied", 35), change("applied", "interviewing", 20)],
  x1: [change("new", "reviewing", 29), change("reviewing", "applied", 27), change("applied", "rejected", 4)],
};
const filtered = [{ at: daysAgo(2), decision: "below-threshold" }, { at: daysAgo(50), decision: "constraint-conflict" }, { at: daysAgo(120), decision: "below-threshold" }];
const o = buildPipelineOverview({ jobs, events, filtered, now, days: 90 });
const stage = id => o.stages.find(s => s.id === id);
check("cohort excludes roles added before the range", o.kpis.added === 6, o.kpis.added);
check("screened out counts the range only", o.kpis.screenedOut === 2, o.kpis.screenedOut);
check("reached counts are cumulative", [6, 4, 3, 1, 0].join() === o.stages.map(s => s.reached).join(), o.stages.map(s => s.reached));
check("new drop is not interested", stage("new").droppedBy.not_interested === 1);
check("applied drop is rejected", stage("applied").droppedBy.rejected === 1);
check("still counts open roles at their furthest stage", stage("reviewing").still === 1 && stage("applied").still === 1);
check("application rate", Math.abs(o.kpis.applicationRate - 0.5) < 1e-9, o.kpis.applicationRate);
check("interview rate", Math.abs(o.kpis.interviewRate - 1 / 3) < 1e-9, o.kpis.interviewRate);
check("median days to apply", o.kpis.medianDaysToApply === 5, o.kpis.medianDaysToApply);
const discovered = o.flow.nodes.find(n => n.id === "discovered");
check("flow starts with roles plus screened out", discovered.value === 8, discovered.value);
const conserved = o.flow.nodes.filter(n => n.kind === "stage").every(n => {
  const out = o.flow.links.filter(l => l.source === n.id).reduce((s, l) => s + l.value, 0);
  return out + n.still === n.value;
});
check("every stage's outflow plus open roles equals its inflow", conserved);
check("no empty drop nodes", o.flow.nodes.every(n => n.kind !== "drop" || n.value > 0));
check("no closed column without offer drops", !o.flow.columns.includes("Closed"));
check("waiting excludes new and sorts oldest first", o.waiting[0].id === "i1" && !o.waiting.some(w => w.stage === "new"), o.waiting.map(w => w.id));
check("waiting skips roles without a known entry date", o.waiting.every(w => w.id !== "old"));
check("activity is newest first", o.activity[0].jobId === "n1" && o.activity[0].kind === "added", o.activity[0]);
check("agent moves are marked", o.activity.find(a => a.jobId === "r1").byAgent === true);
check("activity is limited to the last 30 days", !o.activity.some(a => a.jobId === "i1" && a.to === "reviewing"));
check("weekly intake covers 13 weeks for 90 days", o.weekly.length === 13, o.weekly.length);
check("weekly counts applications", o.weekly.reduce((s, w) => s + w.applied, 0) === 3);
check("ninety days is bucketed by week", o.intakeDays === 7, o.intakeDays);
const week = buildPipelineOverview({ jobs, events, filtered, now, days: 7 });
check("one week is bucketed by day", week.intakeDays === 1 && week.weekly.length === 7, [week.intakeDays, week.weekly.length]);
check("the last day bucket is today", week.weekly[6].weekStart === "2026-11-04", week.weekly[6]);
check("daily intake counts the role added three days ago", week.weekly[3].added === 1, week.weekly.map(w => w.added));
const fortnight = buildPipelineOverview({ jobs, events, filtered, now, days: 14 });
check("two weeks is fourteen daily bars", fortnight.intakeDays === 1 && fortnight.weekly.length === 14);
check("two weeks compares with the fortnight before", fortnight.kpis.added === 3 && fortnight.kpis.addedPrevious === 1, [fortnight.kpis.added, fortnight.kpis.addedPrevious]);
const all = buildPipelineOverview({ jobs, events, filtered, now, days: null });
check("all time includes older roles", all.kpis.added === 7 && all.kpis.addedPrevious === null);

console.log("\n--- endpoint over the in-memory store ---");
const saved = await saveJob({ company: "Synthetic Ltd", role: "Engineering Manager", stage: "new", source: "LinkedIn direct search", sourceType: "job-board" });
await updateJob(saved.id, { stage: "reviewing" });
await updateJob(saved.id, { stage: "applied" });
await recordFilteredJob({ opportunity: { company: "Other", role: "Engineer", sourceUrl: "https://example.com/1" }, decision: "below-threshold", assessment: { score: 40 }, minimumScore: 60 });
const response = await pipelineOverviewResponse({ range: "30" });
check("endpoint reports the range", response.range === "30" && response.ranges.join() === "7,14,30,90", response.ranges);
check("endpoint counts the jobs tabs", response.counts.active === 1 && response.counts.archived === 0 && response.counts.filtered === 1, response.counts);
check("endpoint reads recorded stage history", response.stages.find(s => s.id === "applied").reached === 1, response.stages.map(s => s.reached));
check("endpoint counts screened out roles", response.kpis.screenedOut === 1);
check("endpoint lists the stage changes", response.activity.filter(a => a.kind === "stage").length === 2);
check("unknown range falls back to 30 days", (await pipelineOverviewResponse({ range: "365" })).range === "30");
check("one week is a supported range", (await pipelineOverviewResponse({ range: "7" })).range === "7");

// The admin dashboard reads the overview through the jobs endpoint; a missing
// import there once made every dashboard load fail with "Unexpected error".
process.env.ADMIN_SECRET = "synthetic-admin";
const viaHandler = await new Promise(resolve => {
  const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; },
    json(data) { resolve({ status: this.statusCode, body: data }); return this; } };
  jobsHandler({ method: "GET", query: { overview: "1", range: "30" }, headers: { "x-admin-secret": "synthetic-admin" } }, res);
});
check("admin jobs endpoint serves the overview", viaHandler.status === 200 && !!viaHandler.body.kpis, viaHandler.body);

console.log("\npassed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
