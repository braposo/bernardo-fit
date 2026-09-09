# Implementation plan: a simpler Trigger architecture

Status: Releases A through E are live and validated as of 9 September 2026. The planned Trigger.dev migration is complete.

## 1. Direction

Trigger owns long-running work, retries, concurrency, dependencies, and progress. KV owns durable content and the small amount of metadata needed to attach results safely. Vercel owns authenticated HTTP requests, fast reads/edits, and admission checks. The frontend stays plain HTML with small native JavaScript modules.

We will reduce code and data movement before adding abstractions. In particular, we will not recreate Trigger's lifecycle in an app-owned operation state machine, snapshot every input on every call, or add a deployment registry.

## 2. What moves, what stays

| Move to Trigger | Keep on Vercel/shared store |
|---|---|
| Analysis, with regeneration as a mode | Authentication, validation, public admission limits |
| Cover letters and application answers | Job list/detail and atomic notes/stage/question edits |
| Company research and brief writing | Public report and private artifact reads |
| Research → brief and analyse-all orchestration | Version selection and view-token minting |
| Batch ingest/upsert, bulk adoption/backfills | Small analytics increments and retained usage reads |

The Gmail scan stays with the existing local connector. Posting fetching moves only if a worker-network test proves it works reliably; preserve the local fallback. Export stays a batched synchronous read until measurement justifies generating a downloadable artifact in a task.

Keep the existing src/trigger directory, Node 24 configuration, pinned SDK/build/CLI versions, KV backend, and public permalinks.

## 3. Minimal shared contracts

### One generation path per artifact

Use one analysis implementation for public/admin/create/replace. Keep a thin public worker wrapper where queue/model policy requires it. Regeneration must not duplicate prompt construction, saving, versioning or private scoring.

Keep separate workers only where work needs an independent queue, retry boundary, or reusable result: cover, answer, research, brief, ingest, and orchestrators. Do not create tasks for individual database reads, token minting, telemetry events or each paragraph.

A small task-policy module defines allowed model, effort, token ceiling, timeout and retry categories. API routes trigger by ID; they do not import worker instances and prompt modules.

### Trigger status, small app receipts

The authenticated enqueue route accepts task, job ID, allowed options, and a request ID. A small submission receipt maps that request to the Trigger run and the expected input fingerprint. Repeating the same HTTP request recovers the same dispatch.

The receipt does not store a second queue state, retry history, elapsed timer or log stream. Trigger provides those. Jobs retain the latest request/run pointer for each artifact or question, so admin reloads can discover unfinished work.

Task payloads normally contain identifiers and small options. Workers load needed content once and verify the task-specific input fingerprint. If inputs have changed, return a superseded outcome rather than silently changing what was requested. A deliberate rewrite creates a fresh request ID.

Only inputs without an existing durable home are saved separately: the initial anonymous posting and uploaded ingest batch. Pass a reference to that one copy. The static profile stays in worker code.

Save a result under deterministic request identity before attaching it. A retry reuses that saved artifact. Conditional attachment verifies both the input fingerprint and selected request ID, preserving newer work. If dispatch succeeds but the receipt update fails, repeat the same idempotent dispatch and recover its run ID. Reconcile on retry/reopen rather than introducing a scheduler initially.

A crash between the provider's response and the result write can still incur another model call. This design does not claim exactly-once provider billing.

### One atomic mutation boundary

Use an atomic Redis mutation/CAS implementation shared by HTTP handlers and workers. Keep legacy records readable during migration.

The API must express intent: change notes, change stage, edit question by ID, append/select artifact version. Do not accept old full question arrays or forward stale copies of user-owned fields from ingest. Retry conflicts against current data. All active writers must use this boundary before concurrent workers launch.

Use normalised task-input hashes for freshness; description length is display information only. The current length-based stale flag misses equal-length changes.

### Explicit data views

| Boundary | Send | Leave behind |
|---|---|---|
| Board list | Visible row fields, artifact counts/presence, small source/stale metadata, run IDs | Posting, full answers, letter/history bodies, research and brief text |
| Opened job | Editable posting, notes, instructions and requested question detail | Unopened artifact history |
| Version list | IDs, dates, model, selected flag, word/score summaries | Full versions |
| Task dispatch | IDs, expected fingerprint, allowed options | Full jobs/profile/report history |
| Run progress/output | Phase, identifiers and small counts | Prompts, private writing, research bodies |
| Model prompt | Explicit task input fields | Storage metadata, unrelated artifacts/history |
| Public report | Rendered public fields | Source posting, internal scoring and unknown fields |

Keep broad search by evaluating the existing full-text semantics server-side on the already-loaded jobs, with a debounced search request. Do not send hidden full-text blobs merely to retain browser search. Opening a job loads its editors; do not rerender them when a background task elsewhere completes.

Store new research/brief bodies outside the job key. Move cover history/body out as its worker lands; keep only its small active summary/pointer on the row. Preserve the existing public report storage shape where the live copy makes permalink reads simple.

## 4. Release sequence

### Release A — remove repeated data work and protect writes

**Implement**

- One-pass jobs listing: load the collection once, derive counts, batch unique stats reads, and compare small analysis-source metadata.
- ID-only report traversal for unlinked/adoption checks, removing the current first-100-report limit.
- Job summary/detail projections and targeted PATCH responses.
- Atomic field-specific mutations, including question edits and ingest ownership rules.
- One report reuse policy; fix mutable-report hash mappings and validate cache hits against input fingerprints.
- Extract pure public-report projection from the model-generation module.
- Pipeline usage/analytics writes and read daily rollups together.
- Require persistent KV in workers as well as production HTTP handlers.

**Acceptance**

- Concurrent notes/stage edits survive; question edits cannot overwrite a newly generated answer.
- Regeneration/restoration/deletion cannot leave an old posting hash returning different content or remove another report's cache mapping.
- Board responses omit artifact bodies/history; opening detail and broad text search still work.
- One list request reads the job collection once and no full report merely to show a stale marker.
- Archived/adoption counts remain correct beyond 100 reports.
- Equal-length input changes invalidate reuse and late activation.
- Run all existing tests, add behavioural regressions, and check real Redis atomicity using isolated non-production keys.

**Scope control:** no new database, search index, full event log, or multi-table board model. Measure after these changes before adding indexes or pagination complexity.

### Release B — cover pilot and one run UI

**Implement**

- Cover worker, minimal submission receipt, shared task policy and authenticated admin/run endpoint.
- Move view-token minting to jobs; remove the old cover endpoint in the same website deploy.
- Persist cover artifact/version metadata, including salutation and word count; retain the previous successful letter during a rewrite.
- One browser watchRun helper. Delete cover timestamp/content-sniffing recovery.
- Native frontend modules for run watching and directly testable render helpers.
- Worker-first pinned deployment and a simple dispatch kill switch.

**Transport decision during pilot**

Choose one status path. A compact same-origin status endpoint projecting Trigger runs.retrieve is the low-dependency baseline. Use direct status-only Realtime instead if a supported small browser integration is demonstrably simpler. Do not add React or reverse-engineer the Realtime wire protocol. Do not maintain both paths without an observed need. Direct access must use run-scoped tokens with private columns excluded at the server/token level.

**Acceptance**

- A double-click/repeated request creates one active run.
- Closing/reopening the browser recovers the run; completion fetches only its affected job/artifact.
- Failure after result persistence retries the save without repeating the completed model call.
- An older run cannot replace a newer letter or overwrite edited instructions.
- Letter links, salutation, word count and version selection work.
- Missing credentials/permanent provider errors fail clearly; transient errors retry within a bounded budget.
- Expected Vercel function count stays at 12, verified from build output.

Keep model/prompt behaviour unchanged for this pilot except explicit safety/validation fixes; evaluate prompt changes separately.

### Release C — company research and screen brief

**Completed 9 September 2026.** Deployed with separate research and brief workers plus a prepare-screen parent. The production check exercised fresh research followed by brief writing, validated source references and private response headers, confirmed salary fields were not invented, and removed its temporary job and artifacts. The live response also supplied an object-shaped unknown list; its normalizer was corrected and covered before final deployment.

**Implement**

- Research and brief workers; a small prepare-screen parent reuses valid research or waits for research before writing.
- A company-only research input: identity/domain, relevant company questions and search budget. Do not send the personal profile or writing history.
- Structured, bounded research with stable source IDs, claim evidence, retrieved/publication dates where available, unknowns and explicit partial status.
- Full search results initially for reliable source extraction; optimise response inclusion only after citation-equivalence testing.
- A brief input selector: relevant profile evidence, posting/fit facts, dated conversation context, confirmed personal answers and research.
- A private scrollable page: opening, conversation context, likely answers/questions, flags, company/role reference, sources and unknowns.
- Separate advertised, personally expected and previously discussed salary. Unknown personal facts remain blank.
- Seven-day research reuse by default, explicit refresh, inspect research and rewrite brief.
- Presentation mode; private answers/score/gaps hidden initially; source snapshots remain attached to the brief.
- Lightweight readiness/stale fields on the board; artifact bodies fetched on demand.

**Acceptance**

- Research/write are independently retryable; a failed rewrite preserves research and the prior brief.
- Notes imported from email and web-derived content remain evidence, not trusted system instructions.
- URLs and source references are validated; missing/unsupported claims are visibly unverified.
- Every personal fact has support; no regex silently invents a salary expectation or current start date.
- Bad/expired private tokens fail; responses are private/no-store; token-bearing pages do not leak tokens through referrers.
- Changed inputs mark the brief stale and prevent late activation.
- A controlled live brief is checked against the posting and its cited sources.
- No new Vercel function is required for the brief's static page/private artifact kind.

### Release D — consolidate remaining admin and batch work

**Implement**

- Move answer and the shared analyse/create/replace implementation.
- Add analyse-all in the same release as single analysis, using batchTriggerAndWait with per-child identities and outcomes.
- One completion helper consistently updates versions, source fingerprints and private scoring for all owners of a shared report, including version restoration.
- Delete answer/analysis/regeneration-specific browser recovery and old endpoints.
- Move ingest/upsert and bulk adoption to Trigger; load jobs once per batch and maintain temporary matching maps while applying items.
- Update the ingest CLI for 202/run completion. Keep payload validation/auth on its route.

**Acceptance**

- Existing question ownership, model choice, private scoring, shared permalinks and version behaviour are preserved.
- Five child analyses with one injected failure produce four successful rows and one named failure.
- Parent retry reuses child identities; successful rows are not generated or counted twice.
- Batch ingest preserves user edits, handles matches within one upload, and protects creation identity across concurrent requests.
- A browser reload discovers active runs without full-list polling.
- Expected Vercel count drops to 9 after the remaining generator routes are removed.

### Release E — public asynchronous analysis

**Completed 9 September 2026.** Deployed in Trigger.dev production version `20260909.9` and website commit `8ca2b25`. The public route now reuses completed reports before admission, atomically shares concurrent duplicates, enforces the reviewed size/hour/day defaults, stores one input reference and dispatches a pinned Sonnet worker at concurrency two. Its HMAC-scoped receipt projects only truthful phase, terminal state and report ID; the browser resumes pending work after reload and loads the existing public report endpoint on completion. Dispatch and terminal failures release the active claim for deliberate retry. Local boundary, privacy and recovery tests use no provider calls. Production validation confirmed the new client, 20,000-character ceiling and rejection of a foreign run/token pair without starting paid work.

**Implement**

- Thin public admission endpoint and a public worker wrapper using the shared analysis implementation.
- Validate type/size, keep completed-report reuse through the shared public-safe cache policy, atomically admit unique requests, and pin public model/options server-side.
- Proposed starting limits: 20,000 posting characters, 10 requests/hour/IP, 60 unique accepted generations/day, concurrency 2. Final budget is a review decision.
- Bound attempts, output and continuations; configure spend visibility and a kill switch. A run-count limit is not an exact money guarantee.
- Save the initial posting once; pass its input reference. Avoid a separate snapshot/result copy at every step.
- Reuse the selected run-watching approach with public-scoped access and truthful phases.
- On completion load only the public report projection, preserving existing permalinks.

**Acceptance**

- Cached reports avoid model calls; concurrent duplicates share a run and one generation-budget reservation.
- Terminal failure can be retried deliberately without getting stuck behind the failed run's dedup key.
- Foreign/admin run IDs cannot be inspected with a public token.
- Queue waits, reloads, failed dispatch and provider retry recover predictably.
- Public metadata/output never carries admin notes, private scoring or draft bodies.
- Unique-admission limits pass concurrent boundary tests; no paid model calls are used merely to test the cap.
- Usage attributes provider attempts to request/run IDs.

## 5. Optimisation experiments alongside the releases

These are measured experiments, not prerequisites that expand release A.

1. Explicit model-input projections and compact JSON: implement first; these remove irrelevant fields without summarising useful evidence.
2. Structured provider JSON output: verify configured-model support and semantic validation; remove bespoke repair only after compatibility tests.
3. Task-specific profile/writing blocks: compare quality against current prompts before reducing their 37k–47k fixed characters.
4. Lower effort/smaller model for appropriate form answers and research: keep writing quality as the acceptance criterion.
5. Smaller worker machine: profile actual runs before right-sizing; the only current production task is an example.
6. Company-level research reuse, answer-all, overnight batches and persistent indexes: defer until usage justifies them.

Do not add a model call to summarise inputs simply to save another model call's tokens without measuring total cost and quality.

## 6. Deployment, rollback and verification

Deploy compatible workers before switching the website. Keep a small payload contract version and record both SHAs; avoid per-request deployment discovery or strict SHA equality. Use the pinned CLI through the existing package scripts. Keep development/preview credentials and data separate from production.

For each release, run the full behavioural suite and the Trigger dry-run build where workers change. Verify actual deployment versions and Vercel function counts. Live tests use isolated test jobs and controlled provider calls, never recruiter messages or destructive experiments on active opportunities.

Rollback first disables new dispatch for the affected task, then reconciles/cancels active work before restoring HTTP behaviour. Keep the atomic mutation boundary after workers are enabled; rolling back to old whole-record writers would reintroduce lost updates. Additive artifact data stays readable and preserved.

Run data and content serve different purposes. Trigger retains operational history according to its configured plan; active artifacts and permalinks persist in KV. Set a bounded retention policy for abandoned input uploads, unused receipts and unselected drafts after verifying they are no longer referenced. Start with a proposed 30-day diagnostic window; do not add a general event archive.

## 7. Review choices and completion

Review these product defaults:

- Job editors load when opened; full posting/notes search moves server-side.
- One Prepare screen action, plus inspect/refresh research and rewrite controls.
- A 60-second opening is included as a draft.
- Shared report permalink behaviour stays; this refactor fixes consistent scoring rather than changing ownership.
- Initial public limits and the 30-day diagnostic retention proposal.
- Status transport is selected once during the cover pilot from measured dependency/auth complexity.

The first useful milestone is A–C: fewer repeated reads, safe edits, durable cover generation and sourced private screen preparation. Full completion is A–E: all generation and bounded bulk work run on Trigger, the board is lightweight, there is one run UI and one completion path per artifact, existing links/versions work, and measured tests show the intended reductions in transferred data and repeated work.
