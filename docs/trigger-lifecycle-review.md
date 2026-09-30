# Trigger request lifecycle review

Reviewed 30 September 2026. This is a code review, not evidence of additional production incidents. LinkedIn is being migrated in this PR; the findings below are follow-up work, not implemented changes.

| Priority | Area and evidence | Recommended change |
| --- | --- | --- |
| High | `lib/jev.js:evaluateJev` makes up to three HTTP attempts with a timer and a shared 30-second AbortSignal. `src/trigger/jev.ts` also allows three task attempts. A repeatedly throttled assessment can therefore make up to nine calls; a long Retry-After is discarded when the error is translated. | Give worker Jev calls one native retry owner at a request/stage boundary. Preserve provider status and Retry-After, use Trigger timeout/cancellation, and pass a validated Sanity policy. Keep synchronous chat routing behavior explicit because this helper is shared. Verify 429, 529, cancellation, permanent errors and telemetry per attempt. |
| High | `lib/analysis-work.js:executeAnalysisWork` generates a paid report before saving it. A transient save failure before persistence causes the three-attempt task to generate again. Recovery already works when the report/version was successfully saved. | Isolate generation and persistence into child tasks with stable request-id idempotency keys. Reuse successful child output when retrying persistence; retain supersession and revision checks. Apply the same audit to cover letters and application answers before changing their task policies. Verify a failed first save does not invoke the model twice. |
| Medium | `lib/chat/work.js` catches a failed `saveChatTurn` and returns `storage: failed`. `lib/chat/insights.js` deliberately has maxRetries zero. `src/trigger/admin-chat.ts` correctly has one attempt to avoid replaying a partially streamed answer. | Add a persistence-only child task, keyed by the existing immutable turn request id. Retry the Sanity write without replaying the stream. Keep the saved content and routing metadata in the child payload; preserve access and retention controls. Verify interrupted and completed turns each persist once. |
| Medium | `lib/openai.js` and `lib/anthropic.js` issue raw fetch calls without request-specific cancellation/timeout and discard Retry-After when translating provider errors. Their callers have task compute limits and short generic retries. | Propagate native cancellation, bound HTTP requests with Trigger APIs, and preserve rate-limit metadata for catchError. Use one retry layer per paid request; do not blindly add retry.fetch retries under existing whole-task retries. Store editable provider policy in Sanity. Verify 429 with a long delay, connection timeout and permanent 4xx. |
| Lower | `functions/classify-conversations/classifier.js` uses an AbortSignal timeout for its HTTP call. `src/trigger/classify-chat-conversation.ts` already uses native retry.onThrow per stage and one parent attempt. | Keep the stage boundaries: they prevent a failed write replaying a successful paid classification. Move the HTTP timeout to native retry.fetch when touching this path; avoid adding a second retry owner. |

## Existing behavior to preserve

- `lib/sanity/repository.js`: revision conflicts require rereading and recomputing the mutation. These are optimistic-concurrency operations used by interactive requests as well as workers, not generic transient HTTP retries.
- `lib/cover.js`: the second attempt repairs malformed model output with changed instructions. It is a bounded semantic repair, not repeated transport.
- `lib/anthropic.js`: pause_turn continuation is part of the provider conversation protocol, not failure recovery.
- `api/admin/chat.js`: the SSE connection timeout and reconnect to the same Trigger run serve the browser connection. Reconnection must never dispatch a second generation.
- `lib/chat/agent.js`: maxRetries zero avoids hidden SDK retries during streamed generation.
- Standalone ingestion/fetch CLI polling and pacing are outside hosted task execution. If these become production workflows, move them into Trigger; do not inject task-only durable APIs into a standalone process.

## Rollout order

1. Jev request boundary and provider rate-limit handling.
2. Analysis generation/persistence isolation, then cover and answers.
3. Chat persistence task.
4. Remaining timeout consolidation.

Each change should have targeted failure-injection tests, a named Development worker check and PR CI before release. Retry configuration alone is insufficient: a safe retry boundary must not replay completed paid work or overwrite a newer user edit.

References: [Trigger task retries](https://trigger.dev/docs/errors-retrying), [compute duration and waits](https://trigger.dev/docs/runs/max-duration). [Management API retries](https://trigger.dev/docs/management/errors-and-retries) configure calls to Trigger's API, not arbitrary provider requests.
