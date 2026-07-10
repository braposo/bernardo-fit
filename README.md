# Where I'd fit — Bernardo's job-fit tool

A small tool you can host on your own site. Someone pastes a job description, and it returns an honest, first-person read on how you fit — plus a **permanent shareable link** that stores that exact analysis.

## How it works

```
public/index.html      ← the whole frontend (no build step)
api/analyze.js         ← runs the analysis (your API key stays server-side), saves it, returns an id
api/report.js          ← loads a saved analysis by id (powers the permalink)
api/_profile.js        ← your full profile + the first-person system prompt
api/_store.js          ← storage (Vercel KV by default; swap for anything)
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
