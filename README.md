# Where I'd fit — Bernardo's job-fit tool

A small tool you can host on your own site. Someone pastes a job description, and it returns an honest, first-person read on how you fit — plus a **permanent shareable link** that stores that exact analysis.

## How it works

```
public/index.html       ← the whole frontend (no build step)
public/admin.html       ← admin: job pipeline + saved analyses
api/analyze.js          ← runs the analysis (your API key stays server-side), saves it, returns an id
api/report.js           ← loads a saved analysis by id (powers the permalink)
api/track.js            ← public, aggregate-only view/interaction counters
api/_analyze.js         ← the actual Anthropic call + JSON parsing, shared by analyze and admin regenerate
api/_profile.js         ← your full profile + the first-person system prompt
api/_store.js           ← storage: reports, opportunities, analytics (Vercel KV by default)
api/_admin.js           ← shared-secret auth for the admin endpoints
api/_inbox-scan.js      ← captured Gmail scan, the source for "Import from inbox"
api/_jd-fetched.js      ← job descriptions captured from public LinkedIn postings
api/admin/reports.js    ← list / delete saved analyses
api/admin/regenerate.js ← re-run the analysis for a saved job description, in place
api/admin/jobs.js       ← the job pipeline: list, create, import, update stage, delete
api/admin/analyse.js    ← run a fit analysis for one row or every unanalysed row
```

Flow: paste JD → `/api/analyze` runs it as *you*, in first person → result is stored under a short id → the URL becomes `yoursite.com/?r=abc123` → anyone with that link sees the same read forever.

## Deploy to Vercel (recommended)

1. Push this folder to a Git repo and import it in Vercel (or run `vercel`).
2. In the Vercel dashboard, add a **KV store** (Storage → Create → KV). It auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`. This is what makes the permalinks persist.
3. Add an environment variable **`ANTHROPIC_API_KEY`** with your key.
4. Deploy. Done.

Without a KV store the app still runs, but saved links won't persist across requests (in-memory is dev-only).

## Deploy to Netlify

Works the same way — move `api/*` to `netlify/functions/*`, and swap `api/_store.js` for [Netlify Blobs](https://docs.netlify.com/blobs/overview/) (implement `saveReport`/`getReport`). The frontend needs no changes beyond the function paths.

## Embedding on your existing site

The frontend is one self-contained `index.html`. Drop it at a path like `/fit` on your site, point the two `fetch` calls at wherever your functions live, and you're set. It carries no framework and no external JS dependencies (just Google Fonts).

## Admin page

`/admin` is one screen, gated by a shared secret: set an **`ADMIN_SECRET`** environment variable (a long random string) and enter it on the page. It's kept in `sessionStorage`, nowhere else.

Everything lives in a single pipeline. Each row is an opportunity moving through `new → reviewing → applied → interviewing → offer → rejected → not_a_fit`, carrying its source, arrival date, location and salary where known, an editable job description, free-text notes, a link to the LinkedIn posting, and a link back to the original email thread. Rows are sorted best-fit first and can be filtered by stage, by tier, or by whether a reply is owed.

**The pipeline and the analyses are the same list.** Any analysis run on the public site creates a pipeline row automatically, taking the company and role from the analysis itself. If a row already holds that job description, the analysis links to it rather than creating a duplicate. Going the other way, any row with a job description has a "Generate fit analysis" button, and rows without one can have a description pasted straight into them. Once a row is linked you get "View fit page", "Copy fit link" and "Regenerate", plus view, link-copy and CV-download counts for that page.

Analyses saved before this behaviour existed show up as a prompt at the top of the page offering to pull them in.

Opportunities also come from `api/_inbox-scan.js`, a captured snapshot of a Gmail scan, with the job descriptions in `api/_jd-fetched.js` pulled from the public LinkedIn view of each posting. Both are snapshots taken by hand, not live integrations: the server holds no mail credentials and never scrapes LinkedIn at runtime, since a scheduled function hitting them from a datacentre IP would be blocked quickly and would breach LinkedIn's terms. Refreshing either means re-running the fetch and replacing the file.

"Import from inbox" is an upsert keyed on `externalId` then Gmail thread id, so re-running it refreshes the scan-derived metadata while leaving your stage, notes and linked analysis untouched.

**Analyse all** runs a fit analysis for every row that has a job description but no analysis yet. It goes through `POST /api/admin/analyse`, not the public endpoint, because that one is rate limited to 10 per hour per IP to protect the bill from visitors and the whole pipeline would hit that wall immediately. The limit is pointless there anyway: the caller already holds the admin secret. Deduplication still applies, so a description that has been analysed before costs nothing, and one failure doesn't abort the batch.

Fit scores and tiers come from the scan, weighted location 0.35, AI-or-DX surface 0.35 and leadership scope 0.30. They are a model-generated read against the profile, not employer assessments.

## Analytics

`POST /api/track` takes `{ id, event }` where event is `view`, `copy_link` or `cv_download`, and increments a counter against a saved report. It is deliberately aggregate-only: no IP addresses, user agents, or anything else identifying a visitor, so it answers "was this link opened" and not "who opened it". The report page fires `view` once per load, and the two button events on click. Demo mode never tracks. Failures are swallowed so a visitor never sees an analytics error.

## Editing what it says about you

Everything the tool knows lives in `api/_profile.js`. Update `PROFILE_CONTEXT` there and every future analysis reflects it. The voice (first person, honest, direct) is set in `buildSystemPrompt()`.

## Model

Uses `claude-sonnet-5` (released June 2026 — strong and cheap, with introductory pricing through Aug 31, 2026). Change the `model` field in `api/analyze.js` if you want a different one.

## Cost & abuse protection

Two things keep the endpoint from running up your bill:

- **Deduplication.** Before calling the API, the server hashes the (normalised) job description and checks whether it's been analysed before. If it has, it returns the existing report and permalink instantly — no API call, no extra cost. Trivial differences like spacing and capitalisation still dedupe to the same result.
- **Rate limiting.** New analyses are capped per IP (default **10 per hour**). Cached/deduped hits don't count against the limit. When someone exceeds it they get a friendly "try again in ~N minutes" message. Tune the numbers in `api/analyze.js` (the `checkAndCountRate(ip, limit, windowSeconds)` call).

Both share the same store as the reports, so with Vercel KV they work across serverless invocations out of the box.

<!-- deployed via GitHub integration -->
