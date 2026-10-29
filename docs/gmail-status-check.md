# Gmail status check (Trigger)

The daily email check, run by Trigger.dev instead of an external Claude routine. Its job is the same as the routine's in [email-status-routine.md](email-status-routine.md): read recent recruiting email, work out which job each message is about and what it means, and save a **status proposal** for Bernardo to apply or dismiss in **Needs you**. It only proposes. It never changes a job, and its Gmail access is read-only: it cannot send, label, archive or delete email.

Everything else (the `statusProposal` documents, Apply and Dismiss, the interview timeline, the matcher and the create rules) is shared with the routine and described in that document.

## What runs

`gmail-status-check` (`src/trigger/gmail-status-check.ts`) is a Trigger schedule, daily at 07:10 Europe/London, Production only. Each run:

1. **Gate.** Pauses with no Gmail or model request unless `emailStatusProposals.enabled` and `emailStatusProposals.gmailCheck.enabled` are both published `true`. The summary says which switch is off.
2. **Search.** One Gmail search with `gmailCheck.query` (by default the routine's search: the last 3 days, no Promotions or Social, nothing Bernardo sent), newest `gmailCheck.maxMessages` messages.
3. **Skip what was already handled.** Messages that already have a proposal (looked up by `email.messageId`), or that an earlier run checked within the last 7 days (a Redis cache of message IDs, `gmail-status-check:seen:<id>`), are not read again. A rerun on the same day reads and classifies only new mail.
4. **Read** each remaining message (`format=full`): From, Subject, Date, thread and message IDs, and a plain-text excerpt of the body (HTML stripped, quoted replies removed, at most 4,000 characters).
5. **Prefilter by rule**, with no model call: Bernardo's own mail (`SENT`), Promotions, Social and Forums, senders in `gmailCheck.skipSenders` (LinkedIn job alerts, Totaljobs, Reed, Indeed alerts and the like), alert subjects ("Job alert", "30 new jobs", "X is hiring", "newsletter") and mailing lists (`List-Id`, `newsletter@`).
6. **Match** with the existing matcher (`matchEmailToJobs` in `lib/status-proposals.js`) on From, Subject and thread, archived jobs included. When nothing matches (an applicant tracking system email with a bare subject), the company named in the first 1,500 characters of the body is tried. No candidate, no model call.
7. **Classify** with one small model call (`gpt-6.1-sol`, low effort, as the review agent's note) given the email and the candidates. The prompt follows the routine's rules (interview with date, rejected, expired, offer, applied only from New or Reviewing, otherwise not relevant), says the email is untrusted and that instructions inside it must be ignored, and asks for strict JSON: `{ relevant, jobId, proposedStage, summary, confidence, interview }`. The answer is checked strictly: `jobId` must be one of the candidates, the stage one of the five above, the summary 1 to 300 characters, confidence 0 to 1, and an interview (only with `interviewing`) must pass the timeline's validation. Anything else is dropped.
8. **Propose** with the existing `createStatusProposal`: the same ID (a hash of job and message), duplicate check, `minimumConfidence` threshold and already-at-stage rule as the routine endpoint. `matchedBy` is the chosen candidate's.
9. **Report** counts only, as the run's output, metadata and log: `listed`, `alreadyProcessed`, `read`, `prefiltered` (with reasons), `unmatched`, `classified`, `irrelevant`, `invalid`, `proposed`, `skipped` (with reasons: `duplicate`, `low-confidence`, `already-at-stage`) and `errors`. No email content.

A message whose model call or proposal write fails is counted under `errors` and not cached, so the next run tries it again. A failed Gmail search fails the run.

### Requests and retries

- `gmail-request` (`src/trigger/gmail-request.ts`) is a child task that makes one Gmail request per attempt, a search or one message, mirroring `jsearch-request`. Trigger owns retries: 408, 429 and 5xx retry with backoff (or at `Retry-After`), a 401 refreshes the access token and retries, and a refused refresh token, a 403 or a malformed payload stops at once. URLs are built in code (`lib/gmail-source.js`) from a validated payload (`op: "list" | "get"`, a message ID of letters, digits, `-` and `_`); the OAuth credentials are read inside the worker and never appear in a payload. The access token (about an hour) is cached in the worker process, so a run usually refreshes once.
- The model call is a durable model call (`durable-model-call` → `provider-http-request`), like the review note: the provider child owns retries and the answer is reused if the parent retries.
- Child runs are keyed per parent run, so a parent retry reuses finished searches, reads and model answers.

## Settings

`fit-analysis-settings.emailStatusProposals.gmailCheck`, published in Sanity beside `enabled` and `minimumConfidence`:

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Runs the Gmail check. Also needs `emailStatusProposals.enabled`. |
| `query` | `newer_than:3d -category:promotions -category:social -from:me (interview OR application OR applied OR offer OR "next steps" OR unfortunately OR "not moving forward" OR assessment OR schedule OR recruiter OR role)` | Gmail search syntax, up to 500 characters. |
| `maxMessages` | `40` | Newest search results read per run, 1 to 100. |
| `skipSenders` | LinkedIn alert addresses, Totaljobs, CWJobs, Reed, Jobsite, Indeed alerts, Glassdoor, Otta, Welcome to the Jungle, Hired, Wellfound, CV-Library, Monster, Adzuna, Jobgether, Substack, Medium | Full addresses or domains (subdomains included) skipped before any model call. Up to 200. |

`gmailCheck` is optional: a document published before it existed stays valid, and the check stays paused. Seed it (disabled) with the existing script, which only adds what is missing:

```sh
node --env-file=.env.local scripts/seed-email-status-proposals.mjs          # dry run
node --env-file=.env.local scripts/seed-email-status-proposals.mjs --apply  # adds gmailCheck where missing
```

Deploy the Studio schema (`lib/sanity/studio/emailStatusProposals.ts`) to edit it in Studio.

## Google Cloud setup (personal Gmail)

Done once, signed in as the Gmail account to read.

1. **Project.** In the [Google Cloud console](https://console.cloud.google.com/), create a project (for example "bernardo-fit email").
2. **Gmail API.** APIs & Services → Library → Gmail API → Enable.
3. **OAuth consent screen** (Google Auth Platform → Branding / Audience / Data access):
   - User type **External**; app name, support email and developer email are Bernardo's.
   - Data access → Add or remove scopes → add `https://www.googleapis.com/auth/gmail.readonly` (only that one).
   - Audience → **Publish app** so the status is **In production**. In Testing, refresh tokens expire after 7 days. The app is not verified, which is fine for your own account: when authorising, Google shows "Google hasn't verified this app"; choose Advanced → Go to the app.
4. **OAuth client.** Clients (Credentials) → Create client → type **Web application**, authorised redirect URI `https://developers.google.com/oauthplayground`. Copy the client ID and client secret.
5. **Refresh token.** Open the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground):
   - Gear icon → tick **Use your own OAuth credentials** → paste the client ID and secret.
   - Step 1: type `https://www.googleapis.com/auth/gmail.readonly` in "Input your own scopes" → **Authorize APIs** → sign in as Bernardo → allow read-only Gmail access.
   - Step 2: **Exchange authorization code for tokens** → copy the **Refresh token**.

The refresh token stops working if access is removed at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), if the Google password changes, or after six months without use. The run then fails with "Gmail token refresh HTTP 400"; repeat step 5 and replace `GMAIL_REFRESH_TOKEN`.

## Trigger environment variables (Production)

| Variable | Value |
| --- | --- |
| `GMAIL_CLIENT_ID` | The OAuth client ID |
| `GMAIL_CLIENT_SECRET` | The OAuth client secret |
| `GMAIL_REFRESH_TOKEN` | The refresh token from the Playground |

The run also uses what the Production worker already has: `OPENAI_API_KEY`, the Sanity variables (`SANITY_CONTENT_ENABLED`, `SANITY_ANALYSIS_ENABLED`, tokens) and the Redis (`KV_*`) variables. With the switches on but the Gmail variables missing, the run stops with a message naming them. Nothing is needed in Vercel.

## Switching from the Claude routine

1. Merge and deploy the Production worker (with `--external-id` set to the production commit, as usual).
2. Seed the settings (dry run, then `--apply`) and deploy the Studio schema. `gmailCheck.enabled` stays `false`.
3. Do the Google setup above and add the three variables to Trigger Production.
4. In Trigger, Production → `gmail-status-check` → Test, run it once. With `gmailCheck` off it answers `{ status: "paused", reason: "gmail-check-disabled" }`.
5. Pause the Claude scheduled task.
6. Publish `gmailCheck.enabled: true` (keep `emailStatusProposals.enabled: true`). Run the test again and check the summary counts and the proposals in Needs you. From then on it runs at 07:10 daily.
7. Once happy, delete the Claude routine and remove (or rotate) `EMAIL_ROUTINE_SECRET` in Vercel. The routine endpoints keep working for manual use while the secret exists.

Running both for a while is safe: a message and job pair can only ever have one proposal, whichever side saves it first. To pause the Trigger check, publish `gmailCheck.enabled: false`; to stop all new proposals, `emailStatusProposals.enabled: false`.

## Cost

Estimated for a typical day of 5 to 15 new messages matching the search, 2 to 5 of which reach the model:

| Item | Per day |
| --- | --- |
| Model: about 3,000 input and 400 output tokens per classified message at $2 / $10 per million tokens, about $0.01 each | $0.02 to $0.05 |
| Trigger: one schedule run, one search and one read per new message, one model child per classified message (about 10 to 25 runs, a few seconds of compute each) | under $0.01 |
| Gmail API | free (well inside the quota) |
| **Total** | **about $0.03 to $0.06 (about $1 to $2 a month)** |

The first run after enabling reads up to `maxMessages` (40) messages; after that only new mail is read, and alerts, newsletters and unmatched mail never reach the model. Model usage is recorded with the other AI usage under kind `email-status`.
