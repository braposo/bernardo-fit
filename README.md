# Where I'd fit — Bernardo's job-fit tool

A small tool you can host on your own site. Someone pastes a job description, and it returns an honest, first-person read on how you fit — plus a **permanent shareable link** that stores that exact analysis.

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

Flow: paste JD → `/api/analyze` admits one small background request → Trigger writes the first-person analysis → the page follows its public-scoped status receipt → the URL becomes `yoursite.com/?r=abc123` → anyone with that link sees the same read forever. Reloading while it runs resumes the same request.

## Deploy to Vercel (recommended)

1. Push this folder to a Git repo and import it in Vercel (or run `vercel`).
2. In the Vercel dashboard, add a **KV store** (Storage → Create → KV). It auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`. This is what makes the permalinks persist.
3. Add an environment variable **`ANTHROPIC_API_KEY`** with your key.
4. Deploy. Done.

Without a KV store the app still runs, but saved links won't persist across requests (in-memory is dev-only).

## Trigger.dev

Trigger.dev tasks live in `src/trigger` and are configured by `trigger.config.ts`. Durable workers own public and admin fit analysis, regeneration, cover letters, application answers, company research, screen briefs, ingest, adoption, and the analyse-all orchestration. The SDK, build package and CLI are pinned to the same version so local and cloud builds cannot drift.

```bash
npm run trigger:dev       # register tasks in the development environment and watch for changes
npm run trigger:check     # build the complete task bundle without deploying it
npm run trigger:health    # read the production health report
npm run trigger:deploy    # deploy and promote a production task version
```

The CLI login is stored outside the repository. Run `npm exec -- trigger.dev login` if a machine is not authenticated.

Backend code that starts a task needs `TRIGGER_SECRET_KEY`. Use the development key in `.env.local`; the Trigger.dev Vercel integration injects the correct key into Vercel for deployed environments. Any secret read by task code must also exist in the matching Trigger.dev environment. Vercel variables marked Secret are not copied into Trigger.dev automatically, so add those in Trigger.dev explicitly when a task begins using them.

Set `COVER_DISPATCH_DISABLED=1` in Vercel to stop new cover runs immediately. Accepted runs can still be watched and recovered, and removing the variable re-enables dispatch.

Set `PUBLIC_ANALYSIS_DISABLED=1` in Vercel to stop new public analysis admissions while cached reports remain available. Public status links use an HMAC scoped to one opaque request ID. `PUBLIC_RUN_SECRET` can provide a separate signing key; otherwise `ADMIN_SECRET` is used.

## Deploy to Netlify

Porting requires moving `api/*` to functions, replacing `lib/store.js`, and providing an equivalent durable worker runtime. The frontend needs no changes beyond the function paths.

## Embedding on your existing site

The frontend is one self-contained `index.html`. Drop it at a path like `/fit` on your site, point the two `fetch` calls at wherever your functions live, and you're set. It carries no framework and no external JS dependencies (just Google Fonts).

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

## Scoring is private

Generating an analysis also produces a fit score, a tier and a one-line rationale, weighted location 0.35, AI-or-DX surface 0.35 and leadership scope 0.30. **None of it is public.** The model returns it in an `internal` block that `splitInternal()` pulls off before the report is ever saved, so the score lives on the pipeline row behind the admin secret and never travels with the report. `/api/report` strips the block again on the way out as a second line of defence, in case an older saved report still carries one inline. Regenerating an analysis rescores the row that owns it.

These are a model-generated read against the profile, for triage. They are not employer assessments and no company ever sees one.

## Recurring inbox review

A scheduled task scans Gmail weekly, pulls out individual roles (including the ones buried inside LinkedIn alert digests), fetches each posting's public description, and posts the batch to `POST /api/admin/ingest`. The endpoint returns HTTP 202 and the CLI follows the background run to completion. Stage, notes, score, linked analysis and archived state all survive. New rows arrive unscored, because scoring belongs to the analysis step.

The server still holds no mail credentials. The scan runs agent-side and only the resulting JSON is posted. `scripts/ingest-opportunities.mjs` reads `ADMIN_SECRET` from `.env.local` itself and never prints or forwards it, so whatever assembles the JSON never handles the credential. Populate it once with `vercel env pull`.

## Cover letters

Any row with a fit analysis gets a **Write cover letter** button. The API admits a small ID-only request and Trigger.dev performs the durable generation with bounded retries and concurrency. Letter bodies and version history live under separate artifact keys; the job retains only the active artifact pointer, summary and current run pointer. Existing embedded letters remain readable and migrate when rewritten or selected. Completion opens a printable A4 page with the print dialog already up, so exporting a PDF is one click and a save.

There is no server-side PDF renderer. The template carries correct `@page { size: A4; margin: 0 }` print CSS, so the browser produces a proper vector PDF with selectable text and real fonts. Headless Chromium on Vercel would add ~50MB of bundle, multi-second cold starts and a Chromium version to keep pinned, in exchange for saving one keystroke. Client-side libraries were worse again: html2canvas rasterises the page, which would throw away the typography the design exists for.

The letter inherits the same anti-slop rules as the fit analysis from `lib/writing.js`. One module feeds every writing path.

On top of that the cover prompt carries a specificity test: could this paragraph be pasted unchanged into a letter to another company? If yes it is filler. It is told to name the company, borrow the vocabulary of the posting, address the hiring manager by name when the posting names one, and treat flattery as the opposite of specificity. The job description is passed in separately from the analysis so it can be mined for those details, and is explicitly marked as data rather than instructions.

Length is treated as a layout constraint. The page is a fixed A4 box, so generation is capped at 430 words across 5 to 7 paragraphs. If a letter ever does overflow, the page says so on screen (and hides that warning when printing) rather than exporting a silently truncated letter.

The letter page is reached with a short-lived signed token rather than the admin secret. It opens in a new tab, where the admin page's `sessionStorage` isn't readable; the alternative was moving the secret to `localStorage`, which would outlive the browser session. The token is an HMAC over the job id and an expiry, valid 15 minutes, and never carries the secret itself.

## Analytics

`POST /api/track` takes `{ id, event }` where event is `view`, `copy_link` or `cv_download`, and increments a counter against a saved report. It is deliberately aggregate-only: no IP addresses, user agents, or anything else identifying a visitor, so it answers "was this link opened" and not "who opened it". The report page fires `view` once per load, and the two button events on click. Demo mode never tracks. Failures are swallowed so a visitor never sees an analytics error.

## Editing what it says about you

Everything the tool knows lives in `lib/profile.js`. Update `PROFILE_CONTEXT` there and every future generation reflects it.

## Model

Admin generation uses `claude-opus-5` by default with `claude-sonnet-5` available as the cheaper fallback. Public analysis is pinned to Sonnet. Model policy lives in `lib/models.js`.

## Cost & abuse protection

The public endpoint applies these controls before a worker can make a model call:

- **Deduplication.** Before calling the API, the server hashes the (normalised) job description and checks whether it's been analysed before. If it has, it returns the existing report and permalink instantly — no API call, no extra cost. Trivial differences like spacing and capitalisation still dedupe to the same result.
- **Atomic admission.** Concurrent copies of one posting share one request and consume one reservation. New unique analyses default to **10 per hour per IP** and **60 per UTC day** across the site. The worker queue runs at concurrency **2** with at most three bounded attempts.
- **Size and shutdown controls.** Public postings default to **20,000 characters**. `PUBLIC_ANALYSIS_MAX_CHARS`, `PUBLIC_ANALYSIS_IP_HOURLY_LIMIT`, and `PUBLIC_ANALYSIS_DAILY_LIMIT` tune the admission budget; `PUBLIC_ANALYSIS_DISABLED=1` pauses it immediately.

Claims, counters, input references and public receipts share the report KV store, so the limits and reload recovery work across serverless invocations. Receipts and Trigger payloads carry IDs and fingerprints only; the posting is stored once and private scoring stays on the admin pipeline row.

<!-- deployed via GitHub integration -->
