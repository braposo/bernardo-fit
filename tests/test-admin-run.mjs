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
check("bulk assessment reports completed scores", workCompletion({ ok: true, d: { kind: "jev-score-all", status: "COMPLETED", result: { outcome: "completed", assessed: 2, failed: 0 } } }).text === "2 assessed, 0 failed");

console.log("\n--- realtime run watcher ---");
let calls = [], callbacks, subscriptions = 0, stopped = 0, progress = 0, secondProgress = 0;
const tick = () => new Promise(resolve => setImmediate(resolve));
const watch = createRunWatcher({
  request: async (_, realtime) => { calls.push(realtime); return { ok: true, d: realtime
    ? { runId: 'run1', publicAccessToken: 'scoped-token', kind: 'cover' }
    : { terminal: true, status: 'COMPLETED', result: { outcome: 'completed' } } }; },
  subscribe: (_, handlers) => { subscriptions++; callbacks = handlers; return () => { stopped++; }; },
});
const first = watch('run1', () => { progress++; });
const duplicate = watch('run1', () => { secondProgress++; });
check('duplicate watchers share one promise', first === duplicate);
await tick();
callbacks.onUpdate({ status: 'EXECUTING', metadata: { phase: 'writing' } });
check('subscribers both receive progress', progress === 1 && secondProgress === 1);
check('progress does not poll the status endpoint', calls.length === 1);
let resolved = false; first.then(() => { resolved = true; });
callbacks.onError(new Error('offline'));
await tick();
check('connection loss does not release the pending action', !resolved);
check('token refresh uses the authorized credentials endpoint', await callbacks.refreshAccessToken() === 'scoped-token');
callbacks.onUpdate({ status: 'COMPLETED' });
const done = await first;
check('terminal event fetches the authoritative result', done.d.terminal && calls.filter(x => !x).length === 1);
check('subscription is closed on completion', subscriptions === 1 && stopped === 1);
check('retry status has an honest label', coverPhaseText({ status: 'REATTEMPTING' }) === 'Retrying…');
check('waiting status has an honest label', coverPhaseText({ status: 'WAITING' }) === 'Waiting…');
check('connection error is not shown as task failure', /Reconnecting/.test(coverPhaseText({ connectionError: true })));

for (const status of ['FAILED','CANCELED','CRASHED','INTERRUPTED','SYSTEM_FAILURE','EXPIRED','TIMED_OUT']) {
  let handler;
  const watcher = createRunWatcher({ request: async (_, realtime) => ({ ok: true, d: realtime ? { publicAccessToken: 't' } : { terminal: true, status } }),
    subscribe: (_, h) => { handler = h; return () => {}; } });
  const result = watcher(status); await tick(); handler.onUpdate({ status });
  check(status + ' resolves without restarting work', (await result).d.status === status);
}
let handler, attempts = 0; const timers = [];
const retryWatch = createRunWatcher({
  schedule: fn => timers.push(fn),
  request: async (_, realtime) => realtime ? { ok: true, d: { publicAccessToken: 't' } }
    : ++attempts === 1 ? { ok: false } : { ok: true, d: { terminal: true, status: 'COMPLETED' } },
  subscribe: (_, h) => { handler = h; return () => {}; },
});
const retryResult = retryWatch('retry'); await tick(); handler.onUpdate({ status: 'COMPLETED' }); await tick();
check('result retrieval failure is retried', timers.length === 1);
timers.shift()(); check('result retry recovers completion', (await retryResult).d.status === 'COMPLETED');
const earlyWatch = createRunWatcher({ request: async () => ({ ok: true, d: { terminal: true, status: 'failed', error: 'Dispatch failed' } }), subscribe: () => { throw new Error('Must not subscribe'); } });
check('dispatch failure before a run exists resolves safely', (await earlyWatch('dispatch')).d.error === 'Dispatch failed');
console.log('\npassed ' + pass + ', failed ' + fail);
process.exit(fail ? 1 : 0);
