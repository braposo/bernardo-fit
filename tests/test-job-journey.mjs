import { jobJourney } from "../lib/job-journey.js";
import { saveJob, updateJob } from "../lib/store.js";
import jobsHandler from "../api/admin/jobs.js";

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (e !== undefined ? " -> " + JSON.stringify(e) : "")); } };

const now = new Date("2026-11-05T12:00:00Z");
const daysAgo = d => new Date(now.getTime() - d * 86400000).toISOString();
const change = (from, to, d, id) => ({ type: "status.changed", detail: `${from} → ${to}`, at: daysAgo(d), id: id || `revision-${d}-0` });
const job = (stage, created, extra = {}) => ({ id: "j", company: "Synthetic", role: "Engineering Manager", stage, createdAt: daysAgo(created),
  auditStartedAt: daysAgo(created), auditLegacy: false, archived: ["rejected", "not_interested", "expired"].includes(stage), source: "LinkedIn", ...extra });

console.log("\n--- open role with full history ---");
const open = jobJourney(job("interviewing", 20), [change("new", "reviewing", 18), change("reviewing", "applied", 12), change("applied", "interviewing", 5)], now);
check("four stages in order", open.stages.map(s => s.stage).join() === "new,reviewing,applied,interviewing", open.stages);
check("new lasted two days from when it was added", open.stages[0].days === 2 && open.stages[0].from === daysAgo(20));
check("reviewing lasted six days", open.stages[1].days === 6);
check("current stage is interviewing for five days so far", open.currentStage === "interviewing" && open.currentDays === 5 && open.stages[3].current);
check("applied date is the move to applied", open.appliedAt === daysAgo(12) && open.appliedTimes === 1);
check("eight days to apply", open.daysToApply === 8, open.daysToApply);
check("twenty days in the pipeline", open.totalDays === 20 && open.open);
check("source group", open.source === "LinkedIn");
check("history is complete", open.complete && open.historyFrom === null);

console.log("\n--- reapplied, closed and agent moves ---");
const reapplied = jobJourney(job("rejected", 30), [
  change("new", "reviewing", 29, "revision-a-0"), { type: "agent.moved", detail: "new → reviewing", at: daysAgo(29), id: "revision-a-1" },
  change("reviewing", "applied", 25), change("applied", "reviewing", 20), change("reviewing", "applied", 15), change("applied", "rejected", 3),
], now);
check("last application is the latest move", reapplied.appliedAt === daysAgo(15) && reapplied.appliedTimes === 2);
check("agent move is flagged on that stage", reapplied.stages[1].byAgent && !reapplied.stages[2].byAgent);
check("closed stage has a date and no duration", reapplied.stages.at(-1).closed && reapplied.stages.at(-1).from === daysAgo(3) && reapplied.stages.at(-1).days === null);
check("no current stage once closed", reapplied.currentStage === null && !reapplied.open);
check("pipeline time stops when it closed", reapplied.totalDays === 27, reapplied.totalDays);

const archived = jobJourney(job("reviewing", 10, { archived: true }), [change("new", "reviewing", 8), { type: "job.archived", title: "Archived", at: daysAgo(2), id: "x" }], now);
check("archived by hand ends the last stage", archived.stages[1].to === daysAgo(2) && archived.stages[1].days === 6 && !archived.stages[1].current);
check("archive appears as the last step", archived.stages.at(-1).stage === "archived" && archived.stages.at(-1).from === daysAgo(2));

console.log("\n--- legacy role ---");
const legacy = jobJourney(job("applied", 60, { auditLegacy: true, auditStartedAt: daysAgo(30) }), [change("reviewing", "applied", 10)], now);
check("legacy first stage has no start date", legacy.stages[0].stage === "reviewing" && legacy.stages[0].from === null && legacy.stages[0].days === null);
check("legacy later stage is timed", legacy.currentDays === 10);
check("legacy history says where it began", !legacy.complete && legacy.historyFrom === daysAgo(30));
const untouched = jobJourney(job("new", 40, { auditLegacy: true, auditStartedAt: daysAgo(30) }), [], now);
check("legacy role with no changes shows one undated stage", untouched.stages.length === 1 && untouched.currentSince === null && untouched.currentDays === null);

console.log("\n--- endpoint over the in-memory store ---");
const saved = await saveJob({ company: "Synthetic Ltd", role: "Engineering Manager", stage: "new", source: "LinkedIn direct search", sourceType: "job-board" });
await updateJob(saved.id, { stage: "reviewing" });
await updateJob(saved.id, { stage: "applied" });
process.env.ADMIN_SECRET = "synthetic-admin";
const viaHandler = await new Promise(resolve => {
  const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; },
    json(data) { resolve({ status: this.statusCode, body: data }); return this; } };
  jobsHandler({ method: "GET", query: { id: saved.id, journey: "1" }, headers: { "x-admin-secret": "synthetic-admin" } }, res);
});
const body = viaHandler.body;
check("admin jobs endpoint serves the journey", viaHandler.status === 200 && Array.isArray(body.stages), body);
check("journey lists recorded stages", body.stages.map(s => s.stage).join() === "new,reviewing,applied", body.stages);
check("journey reports the application", !!body.appliedAt && body.currentStage === "applied" && body.stage === "applied");

console.log("\npassed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
