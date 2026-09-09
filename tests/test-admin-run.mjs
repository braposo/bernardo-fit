import { coverCompletion, coverPhaseText, workCompletion, createRunWatcher } from "../public/admin-run.js";

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (e !== undefined ? " -> " + JSON.stringify(e) : "")); } };

console.log("\n--- cover presentation helpers ---");
check("loading has a clear label", coverPhaseText({ phase: "loading" }) === "Starting…");
check("writing has a clear label", coverPhaseText({ phase: "writing" }) === "Writing…");
check("unknown phases stay queued", coverPhaseText({ phase: "waiting" }) === "Queued…");
check("researching has a clear label", coverPhaseText({ phase: "researching" }) === "Researching…");
check("completed result can open", coverCompletion({ ok: true, d: { status: "COMPLETED", result: { outcome: "completed", words: 321 } } }).open === true);
check("superseded result stays closed", coverCompletion({ ok: true, d: { status: "COMPLETED", result: { outcome: "superseded" } } }).open === false);
check("failure keeps its message", coverCompletion({ ok: false, d: { error: "Provider unavailable" } }).text === "Provider unavailable");
check("research completion reports sources", workCompletion({ ok: true, d: { kind: "research", status: "COMPLETED", result: { outcome: "completed", sources: 6 } } }).text === "6 sources");
check("brief completion can open", workCompletion({ ok: true, d: { kind: "brief", status: "COMPLETED", result: { outcome: "completed" } } }).open === true);

console.log("\n--- run watcher ---");
let calls = 0, progress = 0;
const scheduled = [];
const watch = createRunWatcher({
  request: async () => (++calls === 1
    ? { ok: true, d: { terminal: false, phase: "writing" } }
    : { ok: true, d: { terminal: true, status: "COMPLETED" } }),
  schedule: (fn) => scheduled.push(fn), intervalMs: 1, maxAttempts: 3,
});
const first = watch("run1", () => { progress++; });
const duplicate = watch("run1");
check("duplicate watchers share one promise", first === duplicate);
await new Promise((resolve) => setImmediate(resolve));
check("non-terminal progress is reported", progress === 1);
scheduled.shift()();
const done = await first;
check("terminal response resolves", done.d.terminal === true);
check("the shared watcher made two requests", calls === 2, calls);

let attempts = 0;
const timers = [];
const timeoutWatch = createRunWatcher({
  request: async () => { attempts++; return { ok: false, status: 0, d: {} }; },
  schedule: (fn) => timers.push(fn), maxAttempts: 2,
});
const timed = timeoutWatch("run2");
await new Promise((resolve) => setImmediate(resolve));
timers.shift()();
const timeout = await timed;
check("unresolved runs time out", timeout.status === 408);
check("timeout respects the attempt limit", attempts === 2, attempts);

console.log("\npassed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
