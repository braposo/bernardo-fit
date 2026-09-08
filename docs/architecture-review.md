# Architecture review: simplify the Trigger refactor

Reviewed 8 September 2026. Scope: existing API handlers, shared generation/storage/auth modules, admin and public page JavaScript, ingestion scripts, test structure, installed Trigger SDK guidance, and read-only production Trigger state.

## Recommendation

Use Trigger as the execution system, KV as the content store, and Vercel as a thin authenticated HTTP boundary. Keep the plain HTML/JavaScript frontend. The main savings come from eliminating repeated collection reads, full-object transfers, duplicated generation completion code, and excessive prompt context. Moving small database reads into tasks would add a queue hop without solving those problems.

The earlier implementation plan added too much app-owned run infrastructure. Replace a general operation state machine, full input snapshot system, and deployment-version service with Trigger run IDs plus a small submission receipt and conditional artifact writes. Keep the concurrency fix: that is a demonstrated data-loss issue, not speculative infrastructure.

The revised [implementation plan](implementation-plan.md) is the proposed build sequence. This document records evidence and opportunities; production application code has not been changed.

## Evidence and limits

| Check | Result |
|---|---|
| Existing tests, run individually | 31 files; 1,052 assertions passed, zero failed |
| Concurrent patch probe | Updating notes and stage together lost the notes update in the in-memory implementation |
| Deduplication probe | After overwriting a report with a different posting, the old posting hash returned that changed report |
| Staleness probe | Two different 29-character descriptions returned `stale: false` |
| Prompt measurement | Fixed context is 47,403 characters for analysis, 44,397 for cover, 37,149 for answer |
| Unexpected prompt fields | A synthetic unknown report field was forwarded by both cover and answer prompts |
| Synthetic list payload | 20 jobs: 1,009,330 bytes; an illustrative summary projection: 6,226 bytes |
| Trigger production worker | Version 20260908.1, SDK 4.5.16, only `hello-world` registered |
| Trigger production runs, past seven days | One completed example run, 5.0s billed duration, reported cost $0.0002 |

The list fixture used 12,000-character postings, five synthetic paragraphs per letter, ten letter versions, and five answered questions per job. The summary is illustrative, not a complete final UI contract. The approximately 99% difference is not a forecast for the live dataset. Byte counts are uncompressed JSON, prompt measurements are characters rather than tokens, and no live application data or model calls were used for these probes.

The test runner's child-process launch issue remains specific to the review environment; invoking each test directly worked. Passing tests do not cover the demonstrated concurrency and cache-index faults. Production Trigger has no generation workload from which to infer machine sizing, model cost, or latency savings.

## Findings, in implementation priority order

### 1. Job-list refreshes do repeated whole-collection work

**Evidence:** [jobs GET](../api/admin/jobs.js:31), [listAllJobs](../lib/store.js:299), [countArchivedJobs](../lib/store.js:326), and [findUnlinkedReportIds](../lib/store.js:535).

One jobs GET calls `listJobs`, `findUnlinkedReportIds`, and `countArchivedJobs`. Each reads the complete job collection, including archived records. It also reads every linked report to calculate the stale-description marker, fetches statistics, and loads up to 100 full reports merely to count unlinked IDs.

For 20 jobs each linked to a distinct report and 20 reports in the index, this path issues 126 Redis commands by static count. That is not 126 HTTP round trips: the installed `@vercel/kv` client enables auto-pipelining, so concurrent reads can share transport. Nevertheless, the repeated reads, deserialisation, bytes and commands remain.

**Do now:** load jobs once per list request; derive archived counts and filter candidates from that collection; fetch report IDs instead of report bodies for adoption counts; batch stats reads for unique IDs. Store analysis input hash/length alongside the live artifact so checking staleness needs small metadata, not the full analysis. Paginate ID traversal rather than retaining the current 100-report truncation.

**Avoid initially:** new search services, many secondary indexes, materialised board tables, background count-maintenance tasks. One-pass reads and projections are the simpler first step. Add an index only when measurement identifies a remaining bottleneck.

### 2. The browser receives full objects for summary controls

**Evidence:** [jobs response](../api/admin/jobs.js:46), [version summary UI](../public/admin.html:473), [full-list lookup for one row](../public/admin.html:379).

The response spreads every stored job into the list, including posting, instructions, notes, answer bodies, current letter, and all letter versions. The version panel then separately fetches version metadata on demand. The board mostly needs presence/counts for these artifacts.

**Do now:** add explicit `jobSummary` and `jobDetail` projections. List rows carry only visible board fields, artifact presence/counts, stale metadata, and active run IDs. Fetch detail for the opened job and artifact bodies only when viewed. Return a changed summary or changed fields after PATCH, rather than the entire record.

Preserve full-text search over posting and notes by evaluating it server-side on the already-loaded collection, with a debounced query and cancellation of stale responses. Do not silently narrow search to summary fields, and do not send a second full-text search blob to the browser. Moving note editors into opened detail is a visible UI change to review.

### 3. Four browser recovery implementations duplicate Trigger's run state

**Evidence:** [pollFor/recoverable](../public/admin.html:354), [analysisLanded](../public/admin.html:394), [regenLanded](../public/admin.html:401), [answerLanded](../public/admin.html:410), [coverLanded](../public/admin.html:420).

Recovery currently infers completion from timestamps, report IDs, or answer fields. A network failure can cause 30 collection polls over three minutes. `answerLanded` accepts any existing `answeredAt`, so a previously answered question can look like the new draft has completed. `coverLanded` counts `p.text`, while current letters store `p.html`, so its recovered word count is wrong.

**Do now:** delete these helpers as their tasks migrate. Use one `watchRun` frontend module for every generation. Trigger owns status; completion causes one targeted detail/artifact fetch. Keep polling/subscription progress separate from loaded form values so an unrelated completion cannot reset unsaved edits.

Select one transport during the cover pilot. Start with a small authenticated status projection using `runs.retrieve` if direct subscriptions require extra build/protocol machinery. Prefer direct run-scoped Realtime if a supported small browser client can be shipped cleanly. Do not build both transports by default or add React just for a hook. With Realtime, omit payload/output at the token level where supported, not merely through a client preference. [Trigger column filtering](https://trigger.dev/changelog/realtime-skipcolumns)

### 4. Whole-record and whole-question writes lose concurrent changes

**Evidence:** [updateJob](../lib/store.js:402), [cover handler](../api/admin/cover.js:75), [answer handler](../api/admin/answer.js:66), [question editing](../public/admin.html:878), [ingest patch](../api/admin/ingest.js:72).

`updateJob` reads a record, merges and rewrites it. Generation constructs versions/questions from a job fetched before the model call. The browser sends the whole question array, including old answers, when one question changes. Ingest explicitly sends back preserved values from its earlier read. A patch helper alone cannot protect these stale values if callers keep supplying whole arrays and old copies of unrelated fields.

**Do now:** introduce one atomic, field-specific mutation boundary. Merge notes/stage edits into the latest record, mutate questions by question ID, and append/select versions atomically. Ingest writes only owned fields, applying preserve-user-data rules inside the mutation. Use an input fingerprint and the latest selected request ID to prevent stale generations from becoming active.

This does not require a new database or separate task per edit. Short atomic mutations stay on Vercel as well as being shared by workers. Test the Redis path in isolation; the memory probe establishes the race but does not substitute for a real Redis integration check.

### 5. Analysis completion and report ownership are spread across handlers

**Evidence:** [public analysis](../api/analyze.js:17), [admin analysis](../api/admin/analyse.js:23), [regeneration](../api/admin/regenerate.js:39), [version restoration](../api/admin/versions.js:86).

Each path assembles report timestamps/model fields, attaches pipeline rows, and maps private scores differently. Regeneration updates all owners of a shared report, but version restoration updates only the requesting job. Some cached analysis paths leave private scores untouched. These are inconsistent manifestations of the same operation.

**Do now:** one analysis worker/service with explicit public/admin policy and create/replace mode, plus one completion helper for report content, version, source fingerprint, and owner score updates. Keep a thin public worker wrapper if needed for its separate queue/model policy; it should call the same implementation. Regeneration is a mode, not a second copy of the generation algorithm.

Retain existing shared-permalink semantics initially and make all owners consistent on restore. Changing reports to one-owner-per-job is a separate product/data migration, not an accidental optimisation. A public task must never accept arbitrary admin model, instructions, report replacement, or job mutation options from its caller.

### 6. The dedup index is not a reliable content cache

**Evidence:** [saveReport](../lib/store.js:116), [overwriteReport](../lib/store.js:146), [deleteReport](../lib/store.js:242), [findReportByHash](../lib/store.js:598).

The index maps only normalised posting text to a mutable report ID. Overwrite changes content but deliberately leaves the original hash entry. Delete removes the hash of the current posting, which can differ from the old index entry; it can also delete a mapping now owned by another report. Models/instructions/profile versions are not part of the stored key. Admin checks some reuse policy separately, while the public path accepts the existing mapping directly.

**Do now:** a single reuse policy incorporating posting, model, explicit instructions, profile/prompt version, and allowed public/admin context. Validate the target's fingerprint on a hit. On replacement/restoration/deletion, update or conditionally remove only mappings owned by that report. Preserve public permalinks independently of cache eligibility. Do not keep separate dedup algorithms in public, admin, and workers.

### 7. Prompts send far more fixed material than short answers need

**Evidence:** [profile](../lib/profile.js:11), [cover prompt](../lib/cover.js:21), [answer prompt](../lib/answer.js:48).

The shared profile alone is 25,941 characters. Writing constants add another 8,664 characters before task-specific instructions. The fixed answer prompt is 37,149 characters even for a factual question that should return one sentence. Analysis and cover fixed prompts are 47,403 and 44,397 characters respectively.

Cover and answer do already exclude `job_description` from the report JSON when they send the posting separately; there is no literal second full posting in those current prompts. The remaining waste is full profile context, all remaining report fields, pretty-printed metadata, unbounded prior-answer context, and overlapping instruction text. Unknown report fields are forwarded automatically.

**Do now:** explicit `analysisInput`, `coverInput`, `answerInput`, and later `researchInput`/`briefInput` selectors. Exclude storage timestamps, model metadata, versions, counters and IDs from model context unless a specific task needs them. Compact JSON for data blocks. Keep only previous answers preceding the question, as today, and introduce a measured bound without blindly cutting the newest relevant evidence.

**Explore with quality evaluation:** split the source profile into factual sections and reusable evidence examples; compose small task-appropriate views from that one source. Use a concise writing-policy block, retaining rules proven important by existing tests. Structured, user-confirmed factual answers can bypass generation through an explicit form choice; do not rely on a broad regex to decide what a personal question means. Research needs company identity and research questions, not Bernardo's full career or cover-letter writing rules.

These are opportunities, not a promised token saving. Compare quality and API usage on a fixed set before shortening the production prompts. Do not add a model-based summarisation service merely to shrink another call at this volume.

### 8. There is no explicit effort policy in current generator calls

**Evidence:** [shared client](../lib/anthropic.js:54), [analysis call](../lib/analyze.js:13), [cover call](../lib/cover.js:173), [answer call](../lib/answer.js:163).

The client accepts `effort`, but none of the three generators passes it. Usage therefore cannot distinguish an explicit task policy from provider defaults. Token limits are 16,384 for analysis/cover and 4,096 for answers; these are ceilings, not automatic spend.

**Do now:** centralise model, effort, token ceiling, timeout, and permanent/transient failure policy in one task-policy module. Record the actual resolved model and policy version. Keep public configuration server-controlled and preserve writing defaults during transport migration.

**Explore:** lower effort/smaller context for form answers and factual research, validated against existing writing quality. Do not lower token ceilings blindly: a truncated response can cost a full repeat. Cache hits within each task are useful; cross-task reuse requires identical leading blocks, not just the presence of the same profile somewhere.

### 9. JSON repair and broad output spreading complicate correctness

**Evidence:** [analysis parse](../lib/analyze.js:36), [splitInternal](../lib/analyze.js:48), [loose parser](../lib/json.js:9), [cover salvage](../lib/cover.js:193), [public report](../api/report.js:30).

Analysis accepts any parseable object and strips only `internal`; an unexpected field can be stored, publicly returned, and fed into later prompts. Cover validates only that `paragraphs` is an array, then falls back to prose salvage. Parse failures also log raw generated text, which would persist in Trigger logs after migration.

**Do now:** one schema/normalisation boundary per artifact; explicit public report projection; redacted error logs with request/run IDs. Move pure report projection out of the generator module so public reads do not import the profile/prompt/client dependency chain. Public rendering does not use `job_description`; keep it server-side while preserving admin detail/export access.

**Explore early:** provider structured JSON output for analysis, cover and brief, with local semantic validation and refusal/truncation handling retained. This may eliminate much of the bespoke repair/re-prompt/salvage machinery. Keep answers plain text. Verify support with the configured models before removing compatibility parsing. [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)

### 10. Usage and analytics perform serial bookkeeping

**Evidence:** [recordUsage](../lib/usage.js:56), [recentRollups](../lib/usage.js:111), [trackEvent](../lib/store.js:550).

`recordUsage` awaits list push, list trim, then up to seven individual hash increments after every model response. The 30-day usage view awaits each day sequentially. Analytics awaits three writes per click. Auto-pipelining does not combine operations that application code waits for one at a time.

**Do now:** pipeline bookkeeping into bounded requests; fetch daily rollups together; use an atomic script where correctness, rather than transport alone, requires it. Reuse a small KV connection/config helper instead of duplicating configuration and fallback setup in usage and store. Keep telemetry best-effort and time-bounded.

Let Trigger own execution durations/retry logs. Keep only provider token/search accounting in KV where the app needs retained cross-run/model rollups. Do not start a Trigger task for each page view or usage record: that adds more machinery than three cheap counters warrant.

### 11. Ingest scans the collection once per incoming item

**Evidence:** [ingest loop](../api/admin/ingest.js:57), [findExistingJob](../lib/store.js:490).

A batch of M opportunities repeatedly loads J jobs, roughly M × J job reads before writes. The endpoint allows 200 incoming rows. More worker concurrency would multiply that waste instead of fixing it.

**Do in the refactor:** move bounded batch ingestion/upsert work to one Trigger task, keeping authentication and payload validation on the endpoint. Load existing jobs once, build temporary matching maps, and update them as rows are added. Keep sequential application within the batch where it preserves deterministic matching; atomically claim identity on creates to protect concurrent submissions. Update the CLI to accept 202 and wait for completion through the same run contract.

A batch payload is a justified exception to ID-only tasks: validate/store the uploaded batch once and pass its reference, rather than repeat the whole list to child runs. Retain user-owned fields at the mutation boundary.

Gmail scanning remains external because it uses local connector access. Move posting fetching only after a controlled Trigger-network test shows acceptable access; the existing local fetch path remains the fallback. Extract the duplicate `postingId` into a pure shared helper so scripts need not import storage.

### 12. Artifact storage makes a small edit carry historical bodies

**Evidence:** [job record](../lib/store.js:340), [report versions](../lib/store.js:161), [letter token response](../api/letter.js:37).

Every note update reads and writes up to ten letter versions. The active letter duplicates the version's paragraphs, while its salutation is present in a version but omitted from the active fields and letter response; the page defaults to a generic salutation. Reports intentionally duplicate live content and versions to preserve a one-read public path.

**Do now:** remove version bodies from the jobs response immediately. As the cover task lands, move its history/current artifact body out of the job key and retain a small pointer/summary on the job. Include salutation and word count in the artifact projection so the browser neither loses them nor recalculates from the wrong field. New research and briefs should start outside the job record too.

Use one explicit artifact accessor pattern for private drafts, without redesigning the established public-report permalink store. Keep the public live copy if its one-read advantage is useful; not every stored duplicate is waste.

### 13. Staleness measures length rather than changed meaning

**Evidence:** [jdChange](../lib/store.js:43).

The hash detects a difference, but only the absolute length difference can make it stale. Replacing UK remote requirements with US office requirements at equal length looks fresh. Empty text also suppresses the warning. The existing tests deliberately encode length tolerances.

**Do now:** use normalised input hashes as the correctness condition for reuse and late-write checks, and a separate UI label for changed inputs. Do not use the length heuristic as a cache validity rule. Preserve lengths for explanatory UI, not correctness. If boilerplate noise becomes an issue, normalise known boilerplate or show a modest changed marker; do not start with a semantic-comparison model call.

### 14. Small duplication and stale documentation make the migration harder

**Evidence:** [frontend model list](../public/admin.html:295), [backend models](../lib/models.js:24), [question limits](../lib/answer.js:5), [stored question limits](../lib/store.js:270), [UI test extraction](../tests/test-ui.mjs:28), and [README](../README.md).

Models, archive-stage rules, word limits, and posting identity helpers are repeated. The admin page also retains unused report-list variables. Tests extract functions by brace counting or assert source strings, making small restructuring unnecessarily risky. README still describes removed underscore modules, snapshot imports, and obsolete deletion/model behaviour.

**Do during touched work:** return small UI configuration with the initial admin response; extract pure browser rendering and run watching into native ES modules that tests can import. Share genuinely identical validation/identity utilities. Remove unused variables and rewrite README around the final architecture. Do not build a general component framework or undertake unrelated CSS redesign.

## Responsibility boundary

| Responsibility | Owner after refactor | Reason |
|---|---|---|
| Analysis, regeneration mode, covers, answers, research, brief | Trigger workers | Long-running provider calls with bounded retries |
| Research → brief and analyse-all | Trigger orchestration | Durable child results and independent failures |
| Ingest batch/upsert and bulk adoption/backfills | Trigger | Potentially long collection work; return IDs/counts |
| Auth, input limits, public budget admission, enqueue | Vercel | Must reject invalid/abusive work before billing begins |
| Job list/detail, notes/stage edits, version selection | Vercel + shared store | Fast reads/atomic mutations; no queue needed |
| Public reports and private artifact reads | Vercel + KV | Persistent links and narrow response projection |
| Run lifecycle, retries, stage metadata | Trigger | Avoid an app-owned copy of its execution system |
| Latest artifact selection and conditional save | KV | Product data must remain correct and outlive run logs |
| Provider token/search rollups | Small KV telemetry helper | Retained accounting; no task per metric |
| Page-view counters | Existing HTTP endpoint + pipelined KV | Small, best-effort operation |
| Gmail scan | Existing local connector workflow | No equivalent server credential path established |
| Export | Keep synchronous initially; batch its reads | Move to a Trigger-generated downloadable artifact only if measured size/time warrants it |

## Lean run contract

- HTTP submission carries job ID, task/variant and allowed options, plus a stable client request ID for retrying a lost response.
- A minimal receipt records the request-to-run mapping and expected input fingerprint. It is not a lifecycle state machine: no queue status, retry counters, elapsed timer, or copied Trigger logs.
- Workers receive IDs/options, load their required current content once, and verify the fingerprint. They save a generated artifact keyed by request identity before selecting it as active. A retry reuses that artifact if already saved.
- Store only content that has no other durable home, such as the initial public posting or uploaded ingest batch, once under a bounded input reference. Do not snapshot every job/profile/report at every boundary.
- Trigger outputs/metadata contain safe IDs, phase, and small counts, not letter bodies, research notes or prompts. Readers fetch finished content once from the app.
- The job stores the latest request/run pointer per artifact/answer for reload recovery and prevention of stale activation. Trigger remains authoritative about whether a run failed; content remains authoritative about what has successfully been published.
- If dispatch succeeds but receipt update fails, retry the same idempotent submission. Reconcile unresolved receipts when reopened/retried; add a sweeper only if operational evidence requires one. Do not promise exactly-once provider billing across a crash between response and persistence.

## Optimisations to evaluate, not prerequisites

| Experiment | Measure before accepting |
|---|---|
| Shorter task-specific profile/writing blocks | Input/cache/output tokens, quality on rich/sparse roles, unsupported personal claims |
| Structured JSON output | Parse/retry rates and quality; supported schemas/models |
| Direct status-only Realtime | Browser dependency size, response columns, auth/reconnect behaviour, subscription limits |
| Smaller Trigger machine | Peak memory, run duration, failure rate with actual research payloads |
| Company-level research reuse | Correct company/division matching and whether role-specific research differs |
| Answer-all batch action | Evidence repetition and response usefulness versus separate questions |
| Overnight provider batch API | Actual bulk demand and tolerance for delayed results |
| Posting fetch in Trigger | Access reliability and rate limits from the worker environment |
| Persistent indexes / pagination | Measured list latency after one-pass reads and body projection |

Do not simultaneously change the runtime, model, effort, profile length and output schema for the pilot. Establish transport/persistence equivalence first; test quality/cost changes separately.

## Review sources

Local references above identify the inspected code. Trigger behaviour was checked against the installed SDK 4.5.16 skills/docs for task authoring, cost savings, and frontend run access. Live inspection used `get_current_worker`, `list_runs`, and `get_run_details` in read-only mode. The example run does not justify any production generation cost estimate.

External capability references: [Trigger Realtime](https://trigger.dev/docs/realtime/how-it-works), [token-enforced column omission](https://trigger.dev/changelog/realtime-skipcolumns), and [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). Model/tool compatibility remains a live implementation check.
