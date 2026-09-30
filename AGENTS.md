<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.agents/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-authoring-chat-agent`, `trigger-authoring-tasks`, `trigger-chat-agent-advanced`, `trigger-cost-savings`, `trigger-getting-started`, `trigger-realtime-and-frontend`.
<!-- TRIGGER.DEV SKILLS END -->

## Sanity as the source of truth

- Use Sanity for new persistent application data, discovery data, editorial content, prompts, screening rules and user-editable configuration. Read published documents through the existing server-side Sanity adapters and task/request snapshots.
- Do not introduce new durable business/configuration storage in Redis, local files, environment variables or hard-coded runtime constants. Repository defaults are for tests, offline development and non-destructive initial seeding only; hosted features must read and validate published Sanity data.
- Redis may remain a short-lived cache or coordination mechanism (locks, rate limits, expiring task checkpoints). Do not make it the sole source of truth for new durable application records. Preserve existing storage integrations unless migrating them is part of the requested work.
- Add the Sanity schema, runtime validation, cache invalidation and an idempotent seed/migration alongside each new persisted feature. Preserve published edits and unrelated drafts. Fail clearly when required published data is missing or invalid; never silently fall back to stale code defaults in production.
- Keep Sanity credentials server-only and use revision guards for writes that could conflict with editorial changes.

## Prefer Trigger lifecycle features

- Use Trigger.dev for background request execution, retries/backoff, timeouts, durable waits, queues/concurrency, scheduling, idempotency, cancellation, run state, tracing and replay wherever it has a suitable feature. Check the installed SDK's pinned docs before building infrastructure yourself.
- Prefer small child tasks with native `retry` and `catchError`, `retry.fetch` / `timeoutInMs`, `retry.onThrow`, `maxDuration`, `wait.for` / `wait.until`, `triggerAndWait`, and idempotency keys. Do not implement custom attempt loops, sleep/backoff timers, polling schedulers, AbortController timeout engines, or Redis cooldown ledgers when Trigger can own that lifecycle.
- Keep editable domain/provider policy in Sanity and pass its validated snapshot into native Trigger options. Code should supply configuration and provider-specific interpretation, not duplicate Trigger's retry machinery. A small `Retry-After` → `retryAt` adapter is appropriate when the installed SDK cannot interpret the provider's header directly.
- Use `durableModelCall` / `providerFetch` for new worker model integrations and preserve stable request identities. Generated results must survive a failed first persistence write. Provider credentials belong inside the worker, never in task payloads. See `docs/trigger-lifecycle-review.md` for the shared task boundaries and published policies.
- Assign one retry owner to each request: avoid multiplying provider-SDK, `retry.fetch`, child-task and parent-task retries. Checkpoint paid results before retryable writes; do not automatically replay partially streamed or billed generation.
- Distinguish compute limits (`maxDuration`) from wall-clock time: durable waits do not consume compute duration. Queue slots can be released during waits; use source ownership/idempotency where overlapping workflows must remain exclusive, with recovery based on Trigger run state rather than guessed expiry times.
- Browser/SSE connection deadlines, standalone CLI operations, semantic output repair and optimistic-concurrency conflicts are not automatically background-task retries. Preserve those domain/transport boundaries and document any necessary exception before extending custom orchestration.
- References: https://trigger.dev/docs/errors-retrying, https://trigger.dev/docs/runs/max-duration and https://trigger.dev/docs/management/errors-and-retries (the last configures calls to Trigger's API, not arbitrary provider HTTP requests).

## Trigger environment requirement

- Production apps and admin chat must use the hosted Trigger.dev **Production** worker. The user explicitly authorized this on 24 September 2026, superseding the previous Development-only requirement for production.
- Use Trigger.dev **Development** for local work and Vercel preview apps.
- Run the local `trigger dev` worker, using the existing `tr_dev_` key. For branch isolation, use a named Development branch and set the same `TRIGGER_PREVIEW_BRANCH` in the calling app (the SDK uses this variable for Development branches too).
- Production uses a `tr_prod_` key with no Development/Preview branch override. Keep preview/local chat scoped to its Development key and named branch. Do not enable Trigger Preview or Staging unless requested.
- For manual Production worker deployments, pass `--external-id` with the exact Git commit SHA used by the production Vercel app. Automatic version-skew protection otherwise leaves requests in `PENDING_VERSION`; do not disable that protection globally. Verify a request through the production HTTP API, not only a directly triggered health check.
- Keep app and worker Redis namespaces aligned. Reuse existing credentials without displaying them. Verify the Development worker is registered before marking it ready.
- Development tasks execute on the machine running `trigger dev`; the worker must stay running for local/preview use. Production runs on Trigger's hosted workers and must not depend on this computer.

## UI and design work

- Before reviewing or changing user-facing UI, read root `DESIGN.md` and the references it identifies for the affected surface.
- Follow its current design decisions, component patterns, interaction contracts, responsive behaviour and accessibility guidance. Older mockups do not override later approved decisions.
- Verify visual changes in the browser at desktop and mobile sizes, and report any verification that could not be completed.
- Every PR with visual changes must embed labelled before-and-after screenshots in its description, covering the affected UI at desktop and mobile sizes. Capture the base revision and changed revision with identical synthetic content, viewport, state, scroll position and loaded fonts; disable animations and wait for rendering to settle. Inspect both images before sharing. Use durable image links accessible to PR reviewers (commit images under `docs/pr-screenshots/<change>/` if needed), never local filesystem paths. State the revisions, viewport sizes and any capture limitations. If a capture is blocked, document why and which comparison is missing.
- When the user establishes or replaces a reusable design rule, update `DESIGN.md` in the same pull request.

## Git and pull request workflow

- Make every repository change on a dedicated branch and open a GitHub pull request.
- Never commit or push directly to `main` or `master` unless the user explicitly requests that exact action.
- If work starts while `main` or `master` is checked out, create a `codex/` feature branch before editing or committing.
- Keep the pull request focused. Do not merge it unless the user explicitly asks you to merge it.
- Treat the pull request checks as the authoritative full validation for the change.

## Local and CI testing

- While developing, run only the smallest relevant test file or targeted check needed for the code being changed.
- Do not run the complete `npm test` suite locally by default. GitHub Actions runs it for every pull request and after changes land on `master`.
- Run the full suite locally only when the user explicitly asks, or when diagnosing a failure that cannot be isolated with a targeted test.
- Before opening a pull request, run `git diff --check` and report which targeted checks were run. If GitHub Actions fails, fix the failure on the pull request branch and let CI rerun the complete suite.
