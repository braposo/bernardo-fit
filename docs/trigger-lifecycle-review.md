# Trigger request lifecycle

Implemented after the 30 September 2026 app-wide retry review.

Worker generation now runs as an idempotent `durable-model-call` child task. Analysis, cover letters and answers cache their complete generated result before the parent persists it. Other model callers use the same boundary at provider completion. Successful child output is reused on parent retries, so a failed first Sanity write does not pay for generation again. Existing supersession, revision and artifact checks still decide whether the result may attach to a job.

Each HTTP request runs in `provider-http-request`, which owns native task retries, HTTP response timeouts, cancellation and Retry-After scheduling. `retry.fetch` makes one attempt per task attempt. The model task itself has one attempt; exhaustion aborts its caller rather than multiplying retries. Anthropic continuations remain separate requests, and cover-letter semantic repair remains bounded within the generated artifact task. The tailored CV writer likewise gets at most two bounded rewrites inside `application-cv` when a draft only fails on length (over one A4 page or over `maxWords`); each rewrite is its own checkpointed model call carrying the measured overflow. Jev's custom retry loop has been removed.

LinkedIn public requests use the same one-request-per-task-attempt boundary. Trigger SDK 4.5.16 clones each non-2xx response while inspecting status retry rules, including when `byStatus` is empty. Awaiting cancellation of the original response body can therefore wait on the unread clone. Error-path body cleanup is started without awaiting it, so 429 and terminal responses reach native task error handling promptly. A valid `Retry-After` becomes Trigger's `retryAt`; `catchError` stops scheduling after the published attempt limit. `retry.fetch`'s `timeoutInMs` is cleared when response headers arrive, so later body consumption is bounded by the task's `maxDuration` (60 seconds for LinkedIn), not that HTTP timeout. Its separate pre-request pacing wait is durably owned by Trigger. Published pacing is currently 90–150 seconds; repository seed/offline defaults remain 30–60 seconds. Synthetic Development worker probes with a 15-second task limit completed on attempt two for both 429→200 cases (with and without Retry-After); persistent 429 exhausted exactly two attempts and surfaced `LinkedIn HTTP 429`, rather than a compute timeout.

Admin chat still has one streamed generation attempt. Its immutable conversation snapshot goes to `persist-chat-turn`, which retries only storage with a stable request identity and no credentials in its payload. Trigger owns the write's compute timeout; the Sanity client's retry and timeout layers are disabled for this task. An exhausted save remains visible as a failed child run and `storage: failed`, rather than falsely reporting success. Forcefully terminating a streaming task can still interrupt it before a snapshot is submitted; the task does not claim to recover unsubmitted text.

Conversation classification retains separate read/evaluate/write stages. Its provider HTTP call now uses the native request task and cannot be retried again by the stage wrapper after exhaustion. Storage-stage retries remain native `retry.onThrow`. Batch ingestion awaits candidates sequentially because Trigger durable waits must not be wrapped in Promise.all; child queues control concurrency across runs.

## Published configuration

In [Fit Studio](https://job-fit-app.sanity.studio/), open **Analysis settings → Request lifecycle**. Jev, OpenAI, Anthropic and conversation persistence each have timeout and native retry settings. Initial total attempts are three; initial HTTP timeouts are 30 seconds for Jev and 120 seconds for OpenAI/Anthropic. Conversation persistence has a 10-second compute limit. Trigger task limits additionally bound body consumption and model processing; durable waits do not consume compute time.

Hosted calls require the published `fit-analysis-settings.requestLifecycle` snapshot. Policy-only edits do not invalidate fit evidence or completed content. `scripts/seed-request-lifecycle.mjs --apply` adds absent fields under revision guards and preserves edits and drafts. To install the Studio field, copy `lib/sanity/studio/requestLifecycle.ts` and apply `migration/request-lifecycle-studio.patch` after the LinkedIn schema patch.

Idempotency keys are scoped to the parent run and retained for 30 days. They protect automatic retries of that run, not a new user request or indefinite storage. Sanity remains the source of truth for generated artifacts; Trigger results are execution checkpoints. Credentials are read inside request/storage workers and never passed in task payloads. Prompt and result retention follows the existing Trigger project policy.

## Deliberate exceptions

- Standalone CLI and synchronous calls make one HTTP attempt with a caller/transport deadline; durable task waits require a worker context.
- Browser SSE deadlines and reconnects remain transport behavior and never dispatch another generation.
- Sanity revision-conflict loops reread and recompute mutations; they are optimistic concurrency, not HTTP retry infrastructure.
- Chat's streaming provider SDK keeps maxRetries zero. It must not replay a partially billed answer.
- Model refusal, semantic repair and Anthropic pause_turn continuation keep their existing behavior.

## Validation

Failure injection covers failed first saves for analysis, cover and answers, Jev retry exhaustion without multiplication, permanent failures, Retry-After metadata, cancellation, timeout delegation, policy validation and conversation-save retries. Existing provider, chat, admission and supersession tests cover behavior around these boundaries. The named Development worker `codex/request-lifecycle` registered the new tasks. A [live synthetic save-failure probe](https://cloud.trigger.dev/projects/v3/proj_bvmrmtvfeyxpshabcxqv/runs/run_06gf4qp3nmk1lq6rhu20gaqi01) completed on parent attempt two with exactly one child execution, verifying native checkpoint reuse. The temporary probe tasks were removed afterward. A malformed-request probe stopped after one attempt with no HTTP call. No paid model requests were made. This Development environment lacks OpenAI/Anthropic keys; those providers were verified with synthetic responses.

References: [Trigger task retries](https://trigger.dev/docs/errors-retrying), [compute duration and waits](https://trigger.dev/docs/runs/max-duration). [Management API retries](https://trigger.dev/docs/management/errors-and-retries) configure calls to Trigger's API, not arbitrary provider requests.
