export function coverPhaseText(run) {
  if (run?.phase === "researching") return "Researching…";
  if (run?.phase === "writing") return "Writing…";
  if (run?.phase === "loading") return "Starting…";
  return "Queued…";
}

export function workCompletion(out) {
  if (!out?.ok || out.d?.status !== "COMPLETED") {
    return { text: out?.d?.error || "Background work failed.", tone: "err", open: false };
  }
  if (out.d?.result?.outcome !== "completed") return { text: "A newer request replaced this work.", tone: "", open: false };
  if (out.d.kind === "research") return { text: (out.d.result.sources || 0) + " sources", tone: "ok", open: true };
  return { text: "Screen brief ready", tone: "ok", open: true };
}

export function coverCompletion(out) {
  if (!out?.ok || out.d?.status !== "COMPLETED") {
    return { text: out?.d?.error || "Cover generation failed.", tone: "err", open: false };
  }
  if (out.d?.result?.outcome !== "completed") {
    return { text: "A newer request replaced this draft.", tone: "", open: false };
  }
  return { text: `${out.d.result.words || 0} words`, tone: "ok", open: true };
}

export function createRunWatcher({ request, schedule = setTimeout, intervalMs = 2500, maxAttempts = 240 }) {
  const watches = new Map();
  return function watchRun(runId, onProgress) {
    if (watches.has(runId)) return watches.get(runId);
    const watching = new Promise((resolve) => {
      let attempts = 0;
      const check = () => {
        Promise.resolve().then(() => request(runId)).then((out) => {
          if (out.ok && onProgress) onProgress(out.d);
          if (out.ok && out.d?.terminal) {
            watches.delete(runId);
            resolve(out);
            return;
          }
          attempts++;
          if (attempts >= maxAttempts) {
            watches.delete(runId);
            resolve({ ok: false, status: 408, d: { error: "The run is still unresolved. Reload to check it again." } });
            return;
          }
          schedule(check, intervalMs);
        }).catch(() => {
          attempts++;
          if (attempts >= maxAttempts) {
            watches.delete(runId);
            resolve({ ok: false, status: 408, d: { error: "The run is still unresolved. Reload to check it again." } });
          } else {
            schedule(check, intervalMs);
          }
        });
      };
      check();
    });
    watches.set(runId, watching);
    return watching;
  };
}
