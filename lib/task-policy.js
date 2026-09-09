export const COVER_TASK_ID = "cover-letter";
export const RESEARCH_TASK_ID = "company-research";
export const BRIEF_TASK_ID = "screen-brief";
export const PREPARE_SCREEN_TASK_ID = "prepare-screen";

export function coverDispatchEnabled(env = process.env) {
  return !["1", "true", "yes"].includes(String(env.COVER_DISPATCH_DISABLED || "").toLowerCase());
}

export function screenDispatchEnabled(env = process.env) {
  return !["1", "true", "yes"].includes(String(env.SCREEN_DISPATCH_DISABLED || "").toLowerCase());
}

export const COVER_TASK_POLICY = {
  maxDuration: 600,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2_000, maxTimeoutInMs: 30_000, randomize: true },
  concurrencyLimit: 2,
};

export const SCREEN_TASK_POLICY = {
  maxDuration: 900,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2_000, maxTimeoutInMs: 30_000, randomize: true },
  concurrencyLimit: 2,
};

export const TERMINAL_RUN_STATUSES = new Set([
  "COMPLETED", "CANCELED", "FAILED", "CRASHED", "INTERRUPTED", "SYSTEM_FAILURE", "EXPIRED", "TIMED_OUT",
]);
