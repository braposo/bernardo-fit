# Where I'd fit — Bernardo's job-fit tool

A small tool you can host on your own site. Someone pastes a job description, and it returns an honest, first-person read on how you fit — plus a **stable shareable link** to the published analysis.

## How it works

```
public/index.html          ← public fit page
public/admin.html          ← admin pipeline; imports small run helpers from admin-run.js
public/letter.html         ← printable A4 letter
api/*.js                   ← public analysis, report, letter and aggregate analytics endpoints
api/admin/*.js             ← authenticated job, version and task-dispatch endpoints
lib/store.js               ← atomic report and opportunity storage
lib/cover-artifacts.js     ← cover bodies and version metadata outside job records
lib/cover-work.js          ← idempotent cover generation and conditional attachment
src/trigger/*.ts           ← durable workers with bounded retries and concurrency
scripts/ingest-opportunities.mjs ← posts a validated opportunity batch
```

Flow: paste JD → `/api/analyze` admits one small background request → Trigger writes the first-person analysis → the page follows its public-scoped status receipt → the URL becomes `yoursite.com/?r=abc123` → anyone with that link sees the current published version. Reloading while it runs resumes the same request. Admin regeneration keeps earlier versions privately and can publish a new version at the same URL.

## Deploy to Vercel (recommended)

1. Push this folder to a Git repo and import it in Vercel (or run `vercel`).
2. Add an Upstash Redis database from the Vercel Marketplace and connect it to the project. This app's current `@vercel/kv` adapter expects `KV_REST_API_URL` and `KV_REST_API_TOKEN`; map the connected database credentials to those names if the integration uses a different prefix.
3. Add `ADMIN_SECRET`, `ANTHROPIC_API_KEY`, and `OPENAI_API_KEY` to the Vercel environments you use. `PUBLIC_RUN_SECRET` is recommended as a separate signing secret for public status receipts.
4. Connect the Vercel project to Trigger.dev. Verify that Redis and provider credentials are present in the matching Trigger.dev environments and that `TRIGGER_SECRET_KEY` is present in Vercel. The integration can sync these when environment-variable syncing is enabled; otherwise add them manually.
5. Deploy the Trigger.dev workers before the website after existing work has drained. `npm run trigger:check` validates the bundle and `npm run trigger:deploy` deploys it.

Persistent Redis storage is required in production. The in-memory fallback is for local development and tests only; the app deliberately refuses to start in production without `KV_REST_API_URL` and `KV_REST_API_TOKEN`.

## Trigger.dev

Trigger.dev tasks live in `src/trigger` and are configured by `trigger.config.ts`. Durable workers own public and admin fit analysis, regeneration, cover letters, application answers, company research, screen briefs, ingest, adoption, and the listed-role fit assessment batch. The old analyse-all task remains available only to finish existing runs; new bulk actions do not create fit pages. The SDK, build package and CLI are pinned to the same version so local and cloud builds cannot drift.

```bash
npm run trigger:dev       # register tasks in the development environment and watch for changes
npm run trigger:check     # build the complete task bundle without deploying it
npm run trigger:health    # read the production health report
npm run trigger:deploy    # deploy and promote a production task version
```

The CLI login is stored outside the repository. Run `npm exec -- trigger.dev login` if a machine is not authenticated.

Backend code that starts a task needs `TRIGGER_SECRET_KEY`. Use the development key in `.env.local`; the Trigger.dev Vercel integration injects the correct key into Vercel for deployed environments. Any secret read by task code must also exist in the matching Trigger.dev environment. The current integration can sync selected Vercel variables into Trigger.dev; verify the per-environment sync settings, or add the variables in Trigger.dev manually.

The admin chat worker emits AI SDK 7 model spans to Trigger.dev's AI metrics dashboard. Each span includes model, token, and timing data; prompt, retrieved context, tool content, and response recording are disabled. The existing Redis usage records remain the source for the app's admin and per-job cost estimates. Other generators use direct provider requests and are not yet included in Trigger's AI metrics.

Set `COVER_DISPATCH_DISABLED=1` in Vercel to stop new cover runs immediately. Accepted runs can still be watched and recovered, and removing the variable re-enables dispatch.

Set `PUBLIC_ANALYSIS_DISABLED=1` in Vercel to stop new public analysis admissions while cached reports remain available. Public status links use an HMAC scoped to one opaque request ID. `PUBLIC_RUN_SECRET` can provide a separate signing key; otherwise `ADMIN_SECRET` is used.

## Deploy to Netlify

Porting requires moving `api/*` to functions, replacing `lib/store.js`, and providing an equivalent durable worker runtime. The frontend needs no changes beyond the function paths.

## Embedding on your existing site

The frontend is one self-contained `index.html`. Drop it at a path like `/fit` on your site and point its analysis admission, status, report and analytics requests at the corresponding functions. It carries no framework and no external JS dependencies (just Google Fonts).

## Admin page

`/admin` is one screen, gated by a shared secret: set an **`ADMIN_SECRET`** environment variable (a long random string) and enter it on the page. It's kept in `sessionStorage`, nowhere else.

A search box in the toolbar filters the list as you type, across company, role, source, location, salary, notes, rationale, recruiter and the full job description. Multiple words all have to match, so `remote ai` narrows; wrap a phrase in quotes to match it whole, since `"design system"` and `design system` are very different searches. Press `/` to jump to it from anywhere, Escape to clear.

Everything lives in a single pipeline. Each row is an opportunity moving through `new → reviewing → applied → interviewing → offer → rejected → not_a_fit`, carrying its source, arrival date, location and salary where known, an editable job description, free-text notes, a link to the LinkedIn posting, and a link back to the original email thread. Rows are sorted best-fit first and can be filtered by stage, by tier, or by whether a reply is owed.

**The pipeline and the analyses are the same list.** Any analysis run on the public site creates a pipeline row automatically, taking the company and role from the analysis itself. If a row already holds that job description, the analysis links to it rather than creating a duplicate. Going the other way, any row with a job description has a "Generate fit analysis" button, and rows without one can have a description pasted straight into them. Once a row is linked you get "View fit page", "Copy fit link" and "Regenerate", plus view, link-copy and CV-download counts for that page.

Analyses saved before this behaviour existed show up as a prompt at the top of the page offering to pull them in. Adoption runs as a background task and survives a browser reload.

Rows are archived first: an archived row leaves the pipeline but keeps its record, its notes and its fit page, so a link already sent to a recruiter carries on resolving. "Archived (N)" in the toolbar switches to that list, where each row can be restored or permanently removed. Permanent removal leaves the public fit report intact and prevents adoption from recreating the row. Re-importing the inbox scan won't resurrect something you archived, and bulk analysis skips archived rows.

Opportunities can also be posted as a validated batch through `scripts/ingest-opportunities.mjs`. The route authenticates and validates the upload, stores the batch once, and returns a Trigger run ID; the CLI waits on that run and prints the final counts. Gmail access and posting capture stay outside the server, which holds no mail credentials.

"Import from inbox" is an upsert matched by external ID, board posting ID, normalised company and role, then Gmail thread where safe. Each batch loads the pipeline once and updates its temporary match set as it adds rows. Re-running it refreshes scan-derived metadata while leaving stage, notes, linked analysis, archive state and private scoring untouched.

Admin analysis, regeneration and application answers all enter through the shared authenticated run dispatcher at `POST /api/admin/cover`. Vercel sends IDs, an input fingerprint and allowed options; Trigger loads the durable source data, runs the model work, and conditionally attaches the result. The board can analyse one row or use **Analyse all**. Deduplication still applies, so a matching description and model can reuse an existing report without another model call.

**Token cost controls.** The admin's **Save on routine answers** preference is enabled by default and persists in the browser. A small set of exact factual questions uses confirmed profile facts without a model call. Routine motivation questions with an existing fit analysis use Sonnet at medium effort and a compact profile. Ambiguous questions, detailed experience questions and questions with custom role instructions use the selected model and full profile. Turn the preference off for a direct comparison with the full-context path. Other API clients opt in with `economy: true` on answer dispatches.

Full-profile generators share a cached prefix containing the same writing rules and candidate evidence. Answers also cache unchanged job context before the current question and previous answers. Five-minute caching remains the default; `AI_CACHE_TTL=1h` is an optional experiment. Analysis and cover-letter effort default explicitly to high, with `AI_ANALYSE_EFFORT` and `AI_COVER_EFFORT` allowing low/medium/high experiments. Model choice remains available in the admin.

**Usage** opens a private 30-day breakdown by operation, model and effort, including input/output tokens, cache reuse, avoided model calls and estimated USD cost. Existing daily counts remain available; historical calls without pricing are visibly excluded from estimates. New per-request diagnostics expire after 30 days and daily rollups after 90 days. Rates are dated in `lib/usage.js` and need updating when provider pricing changes. Worker records include run ID, task attempt, continuation and letter-generation attempt.

Permanent provider errors, output truncation and exhausted JSON recovery stop automatic regeneration. Letters allow at most two successful provider responses per request, and research allows three provider requests / eight reported searches across continuations and retries, using recorded usage. Accounting is best-effort, so these are safeguards rather than a billing guarantee. Transient provider errors still retry. Equivalent in-flight admin requests share an atomic claim; a new request after completion can still intentionally rewrite. No-op edits and operational question metadata no longer stale screen briefs.

Implementation and validation notes are in [the cost review](docs/cost-optimisation-review.md). Deploy updated workers before the website, after existing work has drained: prompt and fingerprint changes invalidate old generation identities. This does not delete any existing report or artifact.

## Scoring is private

### Jev fit assessments and answer routing

Jev is the decision model accessed directly through TypeSafe, also responsible for selecting writing models. It is available automatically when `TYPESAFE_API_KEY` is configured, with no feature flag. It adds:

- **Assess fit with Jev** in the admin role overview. No full report is required. Five rubric scores use responsibilities (25%), evidence of capability (25%), seniority/scope (20%), career direction (20%), and practical compatibility (10%).
- **Posting quality and hard-constraint checks** in the same assessment. Manual assessments never change an existing job's stage or archive state; ingestion uses these checks when deciding whether to admit a new job.
- **Automatic ingestion screening** evaluates each new opportunity against those same five dimensions before creating a pipeline row. Complete and provisional assessments scoring at least `JEV_INGEST_MIN_SCORE` (default **60/100**) with no flagged hard-constraint conflict are admitted. Existing jobs keep their stage, notes and archive state and receive the usual metadata refresh.
- **Automatic model selection** uses Jev before public and admin fit pages, letters, research, briefs and answers. It chooses among the existing Sonnet, Sol, Astra and Opus models based on task complexity, preferring the least expensive sufficient option. The review shows the choice and policy reason; bulk analysis selects per role. Decisions are cached for unchanged inputs for 30 days and carried into workers. Missing/uncertain confidence uses balanced Sol; a TypeSafe failure blocks the review. Public generation uses the same router inside its worker; visitors cannot override the model and existing request limits still apply. Without the TypeSafe key, public generation falls back to Sonnet and admin generation uses its configured model.
- **Routine-answer routing** when Save on routine answers is enabled. Exact confirmed facts and existing routine matches keep their current context paths. Reviewed Jev model choices are pinned, without a second classifier call. Legacy requests can still use the following routing: Jev can identify additional single-intent motivation questions; only a routine probability of at least 0.95 and reported confidence of at least 0.8 allows compact Sonnet context. Missing confidence, uncertainty, custom instructions or a TypeSafe failure preserve full context and the selected model.

Setup:

1. Save `TYPESAFE_API_KEY` in your ignored `.env.local` for local checks. Never paste it into the admin UI or commit it.
2. Run `npm run jev:check` (Node 22+). This sends one synthetic request to TypeSafe and may use credits; it does not read or change any jobs.
3. Add `TYPESAFE_API_KEY` to matching **Vercel and Trigger.dev** environments. The key makes the web control available and enables Jev answer routing; the Trigger worker makes the scoring request. Deploy the new `jev-score` worker before testing the web control. Use Preview and the matching Trigger.dev environment to test this branch before merging.
4. Open a role, save any context edits, and select **Assess fit with Jev**. The result is private. Existing public fit reports, letters and their versions are unchanged.

For branch testing without preview branches, run `npm run trigger:dev` from this checkout. Trigger Development supplies its saved environment variables to the local worker. The worker must remain running. Run the `jev-check` task in Development with `{}` to verify the direct API using synthetic data and all three question types; it never reads or changes pipeline jobs. Point the Vercel preview's `TRIGGER_SECRET_KEY` at this project's Development environment to dispatch work to this worker, then redeploy that preview. Keep production environment keys unchanged.

Scores come from five-level, zero-indexed rubrics mapped to 0, 20, 40, 65 and 100 points. Level 2 is a plausible but unproven match; level 3 requires clear alignment across most central requirements, and level 4 is reserved for an unusually close match. Each dimension has tailored fit and evidence-sufficiency instructions. Jev estimates all five ratings from the profile and available role context. When role detail cannot justify strong alignment, it uses level 2 or lower and reports uncertainty. Limited evidence (below the 0.8 sufficiency threshold) caps that dimension at 40, adds a clarification note and marks the assessment provisional. An incomplete or uncertain posting caps the weighted overall score at 70. A score above 70 requires strong alignment in responsibilities, capability evidence and career direction; a pronounced gap in any of those caps the total at 55. These limits do not change dimension weights or turn missing facts into known mismatches. Confidence is the model's reported certainty, not an offer probability. Thresholds, point mapping and weights are policy choices that need calibration against personally labelled roles.

The current Jev assessment supplies the admin pipeline score; the old analysis score is retained for comparison. Changes to the profile, rubric, role description, location, salary or saved instructions mark the assessment outdated and withhold the pipeline score until reassessment. Generating or restoring a written report does not overwrite the separate Jev assessment. Failed reassessments retain the previous result and show a failed run.

Requests use the [TypeSafe HTTP API](https://docs.typesafe.ai/api), pinned to `jev-1.13.0`, with a 30-second total timeout. The adapter maps boolean questions to native `noul` and normalizes results for the application. Rate-limit (429) and overload (529) responses receive up to two exponential-backoff retries, honoring Retry-After up to five seconds; longer delays surface as retryable failures. Each attempt is logged. Direct API input usage is estimated at $0.042/million tokens with free output, per the [model pricing](https://docs.typesafe.ai/models). Historical Gateway usage remains unpriced.

Migration: replace `AI_GATEWAY_API_KEY` with `TYPESAFE_API_KEY` in local, Vercel and Trigger.dev environments and deploy the updated workers. Old assessments remain stored but are marked stale by the new model/policy fingerprint; reassess before using them for decisions. Routing caches also include model and policy identity. Score distributions are retained for calibration. No Gateway ZDR routing option is sent: TypeSafe documents no training on customer requests, with ZDR available for enterprise customers. Without a TypeSafe key, existing assessments remain readable and no new unscored jobs are admitted.

### Fit pages never score

Jev is the sole producer of new fit scores. Ingestion uses its five rubric assessments and hard-constraint checks; the weighted total and threshold comparison are inexpensive code, with no writing-model call. Fit-page prompts contain no scoring rubric or private scoring output. Any unsolicited legacy `internal` block is discarded. Generation, cache recovery and version restoration leave both Jev assessments and historical scores unchanged. Historical scores remain private for comparison; `/api/report` still strips old inline blocks defensively.

These are a model-generated read against the profile, for triage. They are not employer assessments and no company ever sees one.

## Recurring inbox review

A recurring agent-side workflow scans Gmail, pulls out individual roles (including the ones buried inside LinkedIn alert digests), fetches each posting's public description, and posts the batch to `POST /api/admin/ingest`. Its schedule lives outside this repository. The endpoint returns HTTP 202 and the CLI follows the background run to completion. Existing jobs retain their stage, notes, score, linked analysis and archived state. New jobs are scored by Jev before admission. Candidates that pass receive a private Overview summary using the existing summary generator, then enter the pipeline with both their assessment and summary attached. Rejected candidates do not incur summary-generation costs. This does not generate a full fit report.

Assessment and summary results are checkpointed separately for 30 days. A summary failure is reported as `summary-failed`, increments `failed`, and leaves the candidate out of the pipeline. Retrying the same request reuses the successful assessment and any completed summary. Existing jobs and archive decisions are not rewritten by this summary step. Deploy the updated ingest worker to enable automatic summaries.

Set `JEV_INGEST_MIN_SCORE` to an integer from 0 to 100 in Vercel (default 60). This is an inclusive minimum, captured with the batch at admission so configuration changes do not change its threshold on retry. Set it in Trigger.dev too for older queued requests that lack a captured policy. There is no feature flag and incoming opportunity JSON cannot override the threshold or supply a trusted score.

The batch result and ingest CLI distinguish `filtered` (below threshold or a hard-constraint conflict), `needsReview` (inaccessible/unrelated posting or no valid assessment), and `failed` (evaluation unavailable or malformed). These candidates are **not added** to the pipeline. Provisional assessments and partial descriptions are admitted when their score meets the threshold and no hard constraint is violated. `screeningRows` lists each candidate and its reason; improve the source description or configuration and resubmit to reconsider it. The original input and successful assessments are retained for 30 days. Failed evaluations are not cached, and the CLI exits unsuccessfully when any evaluation fails, while reporting any jobs that were admitted. A missing TypeSafe key never admits unscored new jobs.

Ingest scoring uses up to four concurrent evaluations. A successful assessment is reused on retry within the same request when the candidate input, profile and rubric are unchanged. Re-importing an existing row does not rescore or remove it; changed scoring inputs mark its retained assessment stale, and **Assess fit with Jev** refreshes it manually. Deploy the updated ingest worker as well as the web branch before testing this flow.

The server still holds no mail credentials. The scan runs agent-side and only the resulting JSON is posted. `scripts/ingest-opportunities.mjs` reads `ADMIN_SECRET` from `.env.local` itself and never prints or forwards it, so whatever assembles the JSON never handles the credential. Populate it once with `vercel env pull`.

## Cover letters

Any row with a fit analysis gets a **Write cover letter** button. The API admits a small ID-only request and Trigger.dev performs the durable generation with bounded retries and concurrency. Letter bodies and version history live under separate artifact keys; the job retains only the active artifact pointer, summary and current run pointer. Existing embedded letters remain readable and migrate when rewritten or selected. Completion opens a printable A4 page with the print dialog already up, so exporting a PDF is one click and a save. For applications that accept only one attachment, **Open CV + letter** prints the existing CV as page one and the saved letter as page two.

There is no server-side PDF renderer. The template carries correct `@page { size: A4; margin: 0 }` print CSS, so the browser produces a proper vector PDF with selectable text and real fonts. Headless Chromium on Vercel would add ~50MB of bundle, multi-second cold starts and a Chromium version to keep pinned, in exchange for saving one keystroke. Client-side libraries were worse again: html2canvas rasterises the page, which would throw away the typography the design exists for.

The letter inherits the same anti-slop rules as the fit analysis from `lib/writing.js`. One module feeds every writing path.

On top of that the cover prompt carries a specificity test: could this paragraph be pasted unchanged into a letter to another company? If yes it is filler. It is told to name the company, borrow the vocabulary of the posting, address the hiring manager by name when the posting names one, and treat flattery as the opposite of specificity. The job description is passed in separately from the analysis so it can be mined for those details, and is explicitly marked as data rather than instructions.

Length is treated as a layout constraint. The page is a fixed A4 box, so generation is capped at 430 words across 5 to 7 paragraphs. If a letter ever does overflow, the page says so on screen (and hides that warning when printing) rather than exporting a silently truncated letter.

The letter page is reached with a short-lived signed token rather than the admin secret. It opens in a new tab, where the admin page's `sessionStorage` isn't readable; the alternative was moving the secret to `localStorage`, which would outlive the browser session. The token is an HMAC over the job id and an expiry, valid 15 minutes, and never carries the secret itself.

## Analytics

`POST /api/track` takes `{ id, event }` where event is `view`, `copy_link` or `cv_download`, and increments a counter against a saved report. It is deliberately aggregate-only: no IP addresses, user agents, or anything else identifying a visitor, so it answers "was this link opened" and not "who opened it". The report page fires `view` once per load, and the two button events on click. Demo mode never tracks. Failures are swallowed so a visitor never sees an analytics error.

## Editing what it says about you

Generation instructions are editable in the standalone Sanity Studio under **Analysis settings**. With `SANITY_ANALYSIS_ENABLED=1`, published settings drive Jev assessments/routing and every writing task. With content storage enabled, **Candidate profile** and referenced evidence supply candidate context and confirmed facts. Drafts have no effect; published changes invalidate relevant reviews and cached results. The preserved baseline in `lib/sanity/analysis-defaults.js` is used while the feature is disabled. See [editing analysis settings](docs/analysis-settings.md) for coordinated web/worker activation.

The initial content is already imported. `SANITY_CONTENT_ENABLED=1` connects app and worker reads/writes for jobs, questions, assessments, reports, covers, research and briefs to Sanity using a server-only editor token. The branch preview enables this connection; production activation remains separate from merge. Redis retains operational coordination and telemetry. Public home/CV renderers still use static files. See [Sanity content storage](docs/sanity-content.md) for verification commands, branch worker setup and remaining migration scope.

## Model

Admin generation defaults to `gpt-5.6-sol`. The picker also offers `gpt-6-astra`, `claude-opus-5` and `claude-sonnet-5`. Saved picker choices are preserved. Alternatives are selected manually; provider errors do not switch models automatically. Set `OPENAI_API_KEY` in both Vercel and Trigger.dev (Production and any Preview/Development environments you use), then deploy both the web app and workers. Keep `ANTHROPIC_API_KEY` for Claude and public generation. Public analysis is pinned to Sonnet. Model policy lives in `lib/models.js`.

## Cost & abuse protection

The public endpoint applies these controls before a worker can make a model call:

- **Deduplication.** Before calling the API, the server hashes the (normalised) job description and checks whether it's been analysed before. If it has, it returns the existing report and permalink instantly — no API call, no extra cost. Trivial differences like spacing and capitalisation still dedupe to the same result.
- **Atomic admission.** Concurrent copies of one posting share one request and consume one reservation. New unique analyses default to **10 per hour per IP** and **60 per UTC day** across the site. The worker queue runs at concurrency **2** with at most three bounded attempts.
- **Size and shutdown controls.** Public postings default to **20,000 characters**. `PUBLIC_ANALYSIS_MAX_CHARS`, `PUBLIC_ANALYSIS_IP_HOURLY_LIMIT`, and `PUBLIC_ANALYSIS_DAILY_LIMIT` tune the admission budget; `PUBLIC_ANALYSIS_DISABLED=1` pauses it immediately.

Claims, counters, input references and public receipts share the report KV store, so the limits and reload recovery work across serverless invocations. Receipts and Trigger payloads carry IDs and fingerprints only; the posting is stored once and private scoring stays on the admin pipeline row.

<!-- deployed via GitHub integration -->

## Model selection

Admin writing defaults to Sol (`gpt-5.6-sol`), with Astra (`gpt-6-astra`), Opus and Sonnet available in the existing picker. Saved selections are preserved. Alternatives are manual; errors never silently switch providers. Public analysis stays on Sonnet.

Set `OPENAI_API_KEY` in both Vercel and Trigger.dev for each environment you use, then deploy both the web app and workers. Keep `ANTHROPIC_API_KEY` for Claude. Keys stay on the server. OpenAI calls use the Responses API with `store: false`; usage separates cached input and includes reasoning in output tokens. Per-call OpenAI cost estimates use published standard rates checked on 17 September 2026.
