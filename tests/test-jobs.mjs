// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

// Exercises the jobs store, the analytics store, and both HTTP handlers
// against the in-memory backend (no KV env vars set).
process.env.ADMIN_SECRET = "test-secret-value";

const store = await import(base + "_store.js");
const jobsHandler = (await import(base + "admin/jobs.js")).default;
const trackHandler = (await import(base + "track.js")).default;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
}
function mockRes() {
  const r = { statusCode: 0, body: null, ended: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => { r.ended = true; return r; };
  r.setHeader = () => r;
  return r;
}
const auth = { "x-admin-secret": "test-secret-value" };

console.log("\n--- store: jobs ---");
const a = await store.saveJob({ company: "Acme", role: "EM", threadId: "t1", receivedAt: "2026-08-01T00:00:00Z" });
const b = await store.saveJob({ company: "Beta", role: "VP", threadId: "t2", receivedAt: "2026-08-10T00:00:00Z" });
check("saveJob returns id", !!a.id && !!b.id);
check("defaults stage to new", a.stage === "new", a.stage);
check("defaults archived false", a.archived === false);
check("listJobs returns both", (await store.listJobs()).length === 2);
check("newest first", (await store.listJobs())[0].company === "Beta");
check("findExistingJob by threadId", (await store.findExistingJob({ threadId: "t1" }))?.company === "Acme");
check("findExistingJob miss", (await store.findExistingJob({ threadId: "nope" })) === null);
check("findExistingJob with nothing", (await store.findExistingJob({})) === null);

const upd = await store.updateJob(a.id, { stage: "applied", notes: "sent" });
check("updateJob sets stage", upd.stage === "applied", upd.stage);
check("updateJob sets notes", upd.notes === "sent");
check("updateJob preserves other fields", upd.company === "Acme");
check("updateJob keeps id", upd.id === a.id);
check("updateJob on missing id -> null", (await store.updateJob("nope", {})) === null);

console.log("\n--- store: metadata fields ---");
const rich = await store.saveJob({
  externalId: "ext-1", company: "Rich", role: "R", score: 77, tier: "Worth a look",
  scoreBreakdown: { location: 1, aiDx: 2, leadership: 3 }, rationale: "why",
  replyOwed: true, userViewed: true, sourceUrl: "https://x", locationMode: "London",
  recruiter: { name: "N", org: "O", daysWaiting: 9 },
});
check("score kept", rich.score === 77, rich.score);
check("tier kept", rich.tier === "Worth a look");
check("breakdown kept", rich.scoreBreakdown && rich.scoreBreakdown.aiDx === 2);
check("rationale kept", rich.rationale === "why");
check("replyOwed kept", rich.replyOwed === true);
check("userViewed kept", rich.userViewed === true);
check("recruiter kept", rich.recruiter && rich.recruiter.daysWaiting === 9);
check("sourceUrl kept", rich.sourceUrl === "https://x");
check("locationMode kept", rich.locationMode === "London");
check("findExistingJob by externalId", (await store.findExistingJob({ externalId: "ext-1" }))?.company === "Rich");
check("score null when absent", (await store.saveJob({ company: "Plain", role: "P" })).score === null);
check("stages include rejected", store.JOB_STAGES.includes("rejected"));
check("stages include not_a_fit", store.JOB_STAGES.includes("not_a_fit"));

console.log("\n--- store: analytics ---");
check("reject unknown event", (await store.trackEvent("r1", "hack")) === false);
check("reject empty id", (await store.trackEvent("", "view")) === false);
await store.trackEvent("r1", "view");
await store.trackEvent("r1", "view");
await store.trackEvent("r1", "cv_download");
const st = (await store.getStats("r1"))["r1"];
check("counts views", st.view === 2, st);
check("counts cv_download", st.cv_download === 1, st);
check("zero for untouched event", st.copy_link === 0);
check("records firstAt/lastAt", !!st.firstAt && !!st.lastAt);
check("getStats handles unknown id", (await store.getStats(["r1", "unknown"])).unknown.view === 0);

console.log("\n--- handler: auth + methods ---");
let res = mockRes();
await jobsHandler({ method: "GET", headers: {}, query: {} }, res);
check("no secret -> 401", res.statusCode === 401);
res = mockRes();
await jobsHandler({ method: "GET", headers: { "x-admin-secret": "wrong-length" }, query: {} }, res);
check("wrong secret -> 401", res.statusCode === 401);
res = mockRes();
await jobsHandler({ method: "PUT", headers: auth, query: {} }, res);
check("bad method -> 405", res.statusCode === 405);

console.log("\n--- handler: GET ---");
res = mockRes();
await jobsHandler({ method: "GET", headers: auth, query: {} }, res);
check("GET 200", res.statusCode === 200);
check("returns jobs", Array.isArray(res.body.jobs));
check("returns stages", res.body.stages.includes("interviewing"));
check("returns archivedCount", typeof res.body.archivedCount === "number");
check("stats null when no fitReportId", res.body.jobs.some((j) => j.stats === null));

await store.updateJob(b.id, { fitReportId: "r1" });
res = mockRes();
await jobsHandler({ method: "GET", headers: auth, query: {} }, res);
check("stats attached via fitReportId", res.body.jobs.find((j) => j.id === b.id).stats.view === 2);

console.log("\n--- handler: PATCH ---");
res = mockRes();
await jobsHandler({ method: "PATCH", headers: auth, query: { id: a.id }, body: { stage: "offer" } }, res);
check("PATCH applies stage", res.statusCode === 200 && res.body.job.stage === "offer");
res = mockRes();
await jobsHandler({ method: "PATCH", headers: auth, query: { id: a.id }, body: { stage: "not_a_fit" } }, res);
check("PATCH accepts not_a_fit", res.statusCode === 200 && res.body.job.stage === "not_a_fit");
res = mockRes();
await jobsHandler({ method: "PATCH", headers: auth, query: { id: a.id }, body: { stage: "bogus" } }, res);
check("PATCH rejects bad stage", res.statusCode === 400);
res = mockRes();
await jobsHandler({ method: "PATCH", headers: auth, query: {}, body: {} }, res);
check("PATCH without id -> 400", res.statusCode === 400);
res = mockRes();
await jobsHandler({ method: "PATCH", headers: auth, query: { id: "nope" }, body: {} }, res);
check("PATCH unknown id -> 404", res.statusCode === 404);

// The import action is gone; the daily inbox ingest does the same upsert, so
// the invariant it protected is tested against the endpoint that still runs.
console.log("\n--- ingest is an upsert that respects what I own ---");
const ingest = (await import(base + "admin/ingest.js")).default;
const opp = { externalId: "ing-1", company: "CINC Systems", role: "Director of Engineering", source: "direct email" };
res = mockRes();
await ingest({ method: "POST", headers: auth, body: { opportunities: [opp] } }, res);
check("first ingest adds", res.body.added === 1, res.body);
const cinc = (await store.listJobs()).find((j) => j.externalId === "ing-1");
await store.updateJob(cinc.id, { stage: "interviewing", notes: "keep me", fitReportId: "myreport" });
res = mockRes();
await ingest({ method: "POST", headers: auth, body: { opportunities: [opp] } }, res);
check("second ingest refreshes rather than duplicating", res.body.updated === 1, res.body);
const after = (await store.listJobs()).find((j) => j.externalId === "ing-1");
check("stage survives re-ingest", after.stage === "interviewing", after.stage);
check("notes survive re-ingest", after.notes === "keep me", after.notes);
check("fitReportId survives re-ingest", after.fitReportId === "myreport", after.fitReportId);
check("no duplicate row", (await store.listJobs({ includeArchived: true })).filter((j) => j.externalId === "ing-1").length === 1);

console.log("\n--- migration: legacy threadId rows match, not duplicate ---");
await store.deleteJob(after.id);
const legacy = await store.saveJob({
  company: "CINC Systems", role: "Principal DesignOps Engineer",
  threadId: "19fa8e8a11fc30ec", stage: "applied", notes: "legacy note",
});
res = mockRes();
// Same thread, now arriving through the ingest the scheduled review uses.
await ingest({ method: "POST", headers: auth, body: { opportunities: [{
  externalId: "cinc-systems--principal-designops-engineer",
  threadId: "19fa8e8a11fc30ec",
  company: "CINC Systems", role: "Principal DesignOps Engineer", source: "direct email",
}] } }, res);
const merged = (await store.listJobs()).filter((j) => j.company === "CINC Systems");
check("legacy row matched on threadId, not duplicated", merged.length === 1, merged.length);
check("legacy stage kept", merged[0].stage === "applied", merged[0].stage);
check("legacy notes kept", merged[0].notes === "legacy note");
check("legacy row gained externalId", merged[0].externalId === "cinc-systems--principal-designops-engineer", merged[0].externalId);

console.log("\n--- nothing is destructively deleted ---");
res = mockRes();
await jobsHandler({ method: "DELETE", headers: auth, query: { id: legacy.id } }, res);
check("DELETE refused while live", res.statusCode === 409, res.statusCode);
check("error points at archiving", /archiv/i.test(res.body.error), res.body.error);
check("row survives the attempt", (await store.getJob(legacy.id)) !== null);
res = mockRes();
await jobsHandler({ method: "PATCH", headers: auth, query: { id: legacy.id }, body: { archived: true } }, res);
check("archive works instead", res.statusCode === 200 && res.body.job.archived === true, res.body);
check("archived row leaves the pipeline", !(await store.listJobs()).some((j) => j.id === legacy.id));
check("but is still retrievable", (await store.getJob(legacy.id)) !== null);

console.log("\n--- handler: /api/track (public) ---");
res = mockRes();
await trackHandler({ method: "GET", body: {} }, res);
check("GET -> 405", res.statusCode === 405);
res = mockRes();
await trackHandler({ method: "POST", body: { id: "r2", event: "view" } }, res);
check("valid track -> 204", res.statusCode === 204 && res.ended);
res = mockRes();
await trackHandler({ method: "POST", body: { id: "r2", event: "nonsense" } }, res);
check("bad event -> 400", res.statusCode === 400);
check("track incremented", (await store.getStats("r2"))["r2"].view === 1);

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
