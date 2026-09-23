export function coverPhaseText(run) {
  if (run?.connectionError) return "Connection interrupted. Reconnecting…";
  if (run?.status === "REATTEMPTING") return "Retrying…";
  if (run?.status === "WAITING") return "Waiting…";
  if (run?.status === "DELAYED") return "Scheduled…";
  if (run?.phase === "scoring") return "Assessing fit…";
  if (run?.phase === "researching") return "Researching…";
  if (run?.phase === "analysing") return "Analysing…";
  if (run?.phase === "answering") return "Drafting…";
  if (run?.phase === "ingesting") return "Importing…";
  if (run?.phase === "adopting") return "Adding…";
  if (run?.phase === "writing") return "Writing…";
  if (run?.phase === "saving") return "Saving…";
  if (run?.phase === "completed" || run?.phase === "superseded") return "Finishing…";
  if (run?.phase === "loading") return "Starting…";
  return run?.status === "EXECUTING" ? "Working…" : "Queued…";
}

export function workCompletion(out) {
  if (!out?.ok || out.d?.status !== "COMPLETED") {
    return { text: out?.d?.error || "Background work failed.", tone: "err", open: false };
  }
  if (out.d?.result?.outcome === "superseded") return { text: "This result no longer matches the role’s current request or inputs.", tone: "", open: false };
  if (out.d?.result?.outcome !== "completed") return { text: "Task completed, but its result details are unavailable.", tone: "err", open: false };
  if (out.d.kind === "jev-score") return { text: "Fit assessment ready", tone: "ok", open: false };
  if (out.d.kind === "research") return { text: (out.d.result.sources || 0) + " sources", tone: "ok", open: true };
  if (out.d.kind === "analyse" || out.d.kind === "regenerate") return { text: "Analysis ready", tone: "ok", open: false };
  if (out.d.kind === "answer") return { text: (out.d.result.refused ? "Needs you" : (out.d.result.words || 0) + " words") +
      (out.d.result.routing === "jev-unavailable-full" ? " · Jev unavailable; used full context" : ""),
    tone: out.d.result.refused || out.d.result.over ? "err" : "ok", open: false };
  if (out.d.kind === "jev-score-all") return { text: out.d.result.assessed + " assessed, " + out.d.result.failed + " failed",
    tone: out.d.result.failed ? "err" : "ok", open: false };
  if (out.d.kind === "ingest") return { text: out.d.result.added + " added, " + out.d.result.updated + " updated, " + out.d.result.failed + " failed", tone: out.d.result.failed ? "err" : "ok", open: false };
  if (out.d.kind === "adopt") return { text: out.d.result.added + " added", tone: "ok", open: false };
  return { text: "Screen brief ready", tone: "ok", open: true };
}

export function coverCompletion(out) {
  if (!out?.ok || out.d?.status !== "COMPLETED") {
    return { text: out?.d?.error || "Cover generation failed.", tone: "err", open: false };
  }
  if (out.d?.result?.outcome === "superseded") return { text: "This draft no longer matches the role’s current request or inputs.", tone: "", open: false };
  if (out.d?.result?.outcome !== "completed") return { text: "Task completed, but its result details are unavailable.", tone: "err", open: false };
  return { text: `${out.d.result.words || 0} words`, tone: "ok", open: true };
}

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'CRASHED', 'INTERRUPTED', 'SYSTEM_FAILURE', 'EXPIRED', 'TIMED_OUT']);

export function createRunWatcher({ request, subscribe, schedule = setTimeout, intervalMs = 5000 }) {
  const watches = new Map();
  return function watchRun(runId, onProgress) {
    if (watches.has(runId)) {
      if (onProgress) watches.get(runId).listeners.add(onProgress);
      return watches.get(runId).promise;
    }
    const entry = { listeners: new Set(onProgress ? [onProgress] : []) };
    const emit = data => entry.listeners.forEach(listener => listener(data));
    entry.promise = new Promise(resolve => {
      let stop, finishing = false;
      async function finish() {
        if (finishing) return;
        finishing = true;
        try {
          const out = await request(runId, false);
          if (!out.ok || !out.d?.terminal) throw new Error('Result not available yet');
          stop?.(); watches.delete(runId); resolve(out);
        } catch {
          finishing = false;
          emit({ connectionError: true });
          schedule(finish, intervalMs);
        }
      }
      async function connect() {
        try {
          const out = await request(runId, true);
          if (out.ok && out.d?.terminal) { watches.delete(runId); resolve(out); return; }
          if (!out.ok || !out.d?.publicAccessToken) throw new Error('Could not connect');
          stop = subscribe(out.d, {
            refreshAccessToken: async () => {
              const fresh = await request(runId, true);
              if (!fresh.ok || !fresh.d?.publicAccessToken) throw new Error('Could not reconnect');
              return fresh.d.publicAccessToken;
            },
            onUpdate: run => {
              emit({ ...out.d, ...run, phase: run.metadata?.phase });
              if (TERMINAL.has(run.status)) finish();
            },
            onError: () => emit({ connectionError: true }),
          });
        } catch {
          emit({ connectionError: true });
          schedule(connect, intervalMs);
        }
      }
      Promise.resolve().then(connect);
    });
    watches.set(runId, entry);
    return entry.promise;
  };
}
