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
api/admin/reports.js    ← list / delete saved analyses
api/admin/regenerate.js ← re-run the analysis for a saved job description, in place
api/admin/jobs.js       ← the job pipeline: list, create, import, update stage, delete
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

`/admin` is gated by a shared secret: set an **`ADMIN_SECRET`** environment variable (a long random string) and enter it on the page. It's kept in `sessionStorage`, nowhere else. Two tabs:

**Pipeline** tracks job opportunities through `new → reviewing → applied → interviewing → offer → closed`. Each entry keeps the source, the date it arrived, location and salary where known, free-text notes, and a link back to the original email thread. If an entry has a job description, one click runs it through the fit analyser and links the resulting page to it. Once linked, the row shows how many times that page was viewed, how often the link was copied, and how many times the CV was downloaded.

Opportunities come from `api/_inbox-scan.js`, a captured snapshot of a Gmail scan. The app has no mail credentials of its own; the scan is run separately and pasted in. "Import from inbox" is idempotent, matched on Gmail thread id, so re-running it never duplicates a row and never overwrites a stage or note you've already set.

**Analyses** lists every saved fit report, and lets you delete one or regenerate it in place (same id, same permalink, fresh content from the current profile and prompt). Regenerating bypasses the dedup cache and the per-IP rate limit, since it's you rather than a visitor.

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
