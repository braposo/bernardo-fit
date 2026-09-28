# Scheduled chat classification

Sanity's `classify-conversations` scheduled function remains the scheduling example. Its unchanged `0 * * * *` schedule selects up to three snapshots, oldest first, that have messages, are more than ten minutes old, belong to `bernardo-fit-admin`, and have neither `classifiedAt` nor `classificationError`.

The function enqueues `classify-chat-conversation` in hosted Trigger Production and returns without waiting for classification. It sends only `{ threadId }`. Function logs contain dispatch counts and Trigger run IDs; acceptance errors leave snapshots pending for the next hourly run and fail the function visibly.

Each Trigger task reads the transcript from Sanity Context, checks that it is still unclassified, loads published Chat settings, calls Jev, and saves the same success/sentiment/content-gap metrics through the Context classification API. Insights remain per-turn snapshots. The hourly schedule, ten-minute cutoff and batch size have not changed. The selector still includes all environments using the admin endpoint, as before.

## Duplicate protection and failures

- Dispatch uses a global idempotency key containing task, organization and snapshot ID, retained for 30 days. Repeated ticks and ambiguous acceptance responses resolve to the same run during that window. Counts represent accepted dispatches, including existing runs, rather than necessarily new executions.
- The task queue has concurrency one. The worker rechecks the stored verdict/error before calling Jev, including after the dispatch key expires.
- Individual stages retry at most three times with bounded backoff. Jev retries transport failures, HTTP 429 and 5xx. Other HTTP errors and invalid responses stop immediately. Retrying a timed-out provider request can still incur another charge if the provider processed it before the timeout.
- Sanity result writes retry separately with the successful Jev result retained in memory, so a write retry does not call Jev again. Whole-task automatic retries are disabled.
- The terminal failure hook records a safe `classificationError` only after stage retries are exhausted. It rechecks the stored verdict first to avoid marking an ambiguously successful write as failed. Transcripts and upstream error bodies are not included in task output or stored diagnostics.
- A worker crash, timeout or failure to persist the terminal error may leave a snapshot pending. Inspect the run IDs in the Sanity function logs; the 30-day dispatch key can keep returning that run. Trigger lifecycle failure hooks do not cover every platform failure status.

For explicit reprocessing, first inspect the Trigger run and confirm no run for the snapshot is active. Clear the recorded `classificationError` in Context using authorized tooling, then replay the task in Trigger (or reset its dispatch idempotency key before the next schedule). Replaying without clearing the error deliberately skips the snapshot. A completed verdict also skips; do not clear it unless reclassification is intended.

## Deployment order

1. Deploy the worker containing `classify-chat-conversation` to Trigger Production. Follow `AGENTS.md` for the production external deployment ID; this PR alone does not deploy either service.
2. Confirm the worker has `SANITY_CONTEXT_WRITE_TOKEN` (Context Editor), `SANITY_READ_TOKEN` (published Chat settings), and `TYPESAFE_API_KEY`. The existing chat worker already uses these credentials, but verify their presence in Production.
3. Configure `TRIGGER_SECRET_KEY` with the Production `tr_prod_` key on the Sanity function. Keep `SANITY_CONTEXT_WRITE_TOKEN` there for the selection query. Do not set `TRIGGER_PREVIEW_BRANCH`; the scheduled entrypoint rejects Development keys and branch overrides.
4. Deploy the Sanity Blueprint/function with its updated package and lockfile. The schedule stays unchanged. It no longer requires `TYPESAFE_API_KEY` or `SANITY_READ_TOKEN`; remove those function credentials after the handoff is verified.
5. On the next scheduled run, follow its logged run IDs in Trigger and verify a classified result in Context Insights. This executes paid Jev requests against the selected transcripts.

For rollback, restore the previous direct-classification function only after any queued/running Trigger classifications have finished or been cancelled, to avoid overlapping paid requests.

## Local verification

`node tests/test-chat-classification.mjs`, `node tests/test-admin-chat.mjs`, and `node tests/test-chat-settings.mjs` use fixtures/mocks; they do not call paid providers or mutate live Context data. The classification tests exercise the SDK retry helper with waits stubbed out, stable dispatch keys, safe failures, duplicate skips and independent storage retries.
