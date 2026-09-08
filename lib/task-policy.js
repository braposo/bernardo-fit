export const COVER_TASK_ID = "cover-letter";

export const COVER_TASK_POLICY = {
  maxDuration: 600,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2_000, maxTimeoutInMs: 30_000, randomize: true },
  concurrencyLimit: 2,
};

export const TERMINAL_RUN_STATUSES = new Set([
  "COMPLETED", "CANCELED", "FAILED", "CRASHED", "INTERRUPTED", "SYSTEM_FAILURE", "EXPIRED", "TIMED_OUT",
]);
