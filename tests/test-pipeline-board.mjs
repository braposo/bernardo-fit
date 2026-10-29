import { BOARD_COLUMNS, isReadyToApply, boardColumnId, groupByColumn, columnActivity } from "../public/pipeline-board.js";

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (e !== undefined ? " -> " + JSON.stringify(e) : "")); } };

const cv = { currentVersionId: "cv-v1" };
const ready = (extra = {}) => ({ id: "r", stage: "reviewing", fitReportId: "fit1", applicationCv: cv, questionCount: 0, answeredCount: 0, ...extra });
const running = status => ({ runId: "run_1", status });

console.log("\n--- board columns ---");
check("six active columns in order", BOARD_COLUMNS.map(c => c.id).join() === "new,reviewing,ready,applied,interviewing,offer");
check("column labels are readable", BOARD_COLUMNS.find(c => c.id === "ready").label === "Ready to apply");

console.log("\n--- ready to apply is derived ---");
check("reviewing with fit page and CV is ready", isReadyToApply(ready()));
check("fit page only stays in reviewing", !isReadyToApply(ready({ applicationCv: { status: "missing" } })));
check("CV only stays in reviewing", !isReadyToApply(ready({ fitReportId: "" })));
check("a saved but unpublished CV is not ready", !isReadyToApply(ready({ applicationCv: { latestVersionId: "cv-v2", currentVersionId: "" } })));
check("a CV fit link counts as a tailored CV", isReadyToApply(ready({ applicationCv: { fitUrl: "/fit/personalised-x" } })));
check("unanswered application questions block ready", !isReadyToApply(ready({ questionCount: 3, answeredCount: 2 })));
check("answered application questions allow ready", isReadyToApply(ready({ questionCount: 3, answeredCount: 3 })));
check("question arrays work when counts are absent", !isReadyToApply(ready({ questionCount: undefined, answeredCount: undefined, questions: [{ q: "Why?", a: "" }] })));
check("refused questions count as done", isReadyToApply(ready({ questionCount: undefined, answeredCount: undefined, questions: [{ q: "Why?", refused: true }] })));
const pc = (...states) => ({ postingCheck: { status: "checked", gaps: [], form: { source: "greenhouse", status: "ready", questions: states.map((state, i) => ({ id: "pq" + i, text: "Question " + i, state })) } } });
check("a null posting check changes nothing", isReadyToApply(ready({ postingCheck: null })));
check("a posting check with no form questions changes nothing", isReadyToApply(ready(pc())) && isReadyToApply(ready({ postingCheck: { status: "partial", gaps: [{ id: "g1", state: "open" }], form: { status: "unavailable", questions: [] } } })));
check("a drafted posting answer blocks ready", !isReadyToApply(ready(pc("approved", "drafted"))));
check("a pending posting answer blocks ready", !isReadyToApply(ready(pc("pending"))));
check("approved and skipped posting answers allow ready", isReadyToApply(ready(pc("approved", "skipped"))));
check("a check without a form object is tolerated", isReadyToApply(ready({ postingCheck: { status: "checked", gaps: [] } })));
check("other stages are never ready", ["new", "applied", "interviewing", "offer", "rejected"].every(stage => !isReadyToApply(ready({ stage }))));
check("missing job is not ready", !isReadyToApply(null) && !isReadyToApply(undefined));

console.log("\n--- column placement ---");
check("ready job lands in Ready to apply", boardColumnId(ready()) === "ready");
check("incomplete reviewing job stays in Reviewing", boardColumnId(ready({ fitReportId: "" })) === "reviewing");
check("active stages map to their own column", ["new", "applied", "interviewing", "offer"].every(stage => boardColumnId({ stage }) === stage));
check("archived stages are not on the board", ["rejected", "not_interested", "expired"].every(stage => boardColumnId({ stage }) === null));
check("a stage called ready is not a stored stage", boardColumnId({ stage: "ready" }) === null);
const jobs = [{ id: "a", stage: "new" }, ready({ id: "b" }), { id: "c", stage: "reviewing" }, { id: "d", stage: "new" }, { id: "e", stage: "expired" }, ready({ id: "f" })];
const groups = groupByColumn(jobs);
check("grouping keeps incoming order inside columns", groups.new.map(j => j.id).join() === "a,d" && groups.ready.map(j => j.id).join() === "b,f");
check("grouping drops off-board stages and keeps empty columns", groups.reviewing.map(j => j.id).join() === "c" && groups.offer.length === 0 && !("expired" in groups));
check("grouping does not change stored stages", jobs[1].stage === "reviewing");
check("grouping tolerates no input", groupByColumn(undefined).new.length === 0);

console.log("\n--- column activity ---");
check("idle column has no line", columnActivity([{ stage: "new" }, ready()]) === "");
check("empty column has no line", columnActivity([]) === "" && columnActivity(undefined) === "");
check("CV generation is counted", columnActivity([{ applicationRun: running("queued") }, { applicationCv: { run: running("running") } }]) === "2 CVs generating");
check("one CV uses the singular", columnActivity([{ applicationRun: running("dispatching") }]) === "1 CV generating");
check("assessment runs are counted", columnActivity([{ jevRun: running("queued") }]) === "1 assessment running");
check("several kinds join in one short line", columnActivity([{ jevRun: running("queued"), coverRun: running("queued") }, { prepareRun: running("queued") }]) === "1 assessment running · 1 letter generating · 1 prep running");
check("finished and failed runs are not counted", columnActivity([{ applicationRun: { runId: "x", status: "completed" } }, { coverRun: { runId: "y", status: "failed" } }]) === "");
check("a run without an id is not counted", columnActivity([{ applicationRun: { status: "queued" } }]) === "");

console.log("\npassed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
