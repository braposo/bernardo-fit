# Posting check

When a job moves to **Reviewing**, the posting check looks for two things Bernardo needs before he applies:

1. **What the posting leaves out**: salary, location and office days, seniority or team size, visa or contract terms. Each gap becomes an item with a short label, why it matters, and a one-line question for the recruiter.
2. **What the application form asks**: the public form questions of Greenhouse jobs, or questions Bernardo pastes from any other form. Each one gets a drafted answer from the existing application answer writer, or is flagged as needing him.

**Nothing is ever submitted.** Gaps wait to be dismissed or turned into a recruiter question (the text is stored; drafting the email in Gmail happens outside the backend). Drafted answers wait for approval; approving one saves it into the job's existing application questions, exactly as if it had been written there.

## When it runs

The `check-posting` Trigger task (payload `{ jobId, force? }`) is requested by `requestPostingCheck`, which `reviewingGenerationResult` calls every time Reviewing generation is started:

- when a job is created at Reviewing or moved there (`POST`/`PATCH /api/admin/jobs`);
- when the fit analysis for a Reviewing job completes (the analysis worker's follow-up). This second request is what drafts form answers, because they are written from the fit page.

It is also requested after **paste questions** and by **re-run**.

The idempotency key is `check-posting:<job id>:<posting fingerprint>:<fit|nofit>:<ats|pasted-questions hash>:<POSTING_CHECK_POLICY>`, global scope, kept 30 days. The posting fingerprint covers the description, salary, location, location mode and source URL. So the check runs once when the job reaches Reviewing, once more when the fit page exists, once per new paste, and again when the posting or the policy changes. Re-run appends `:rerun:<time>` and sets `force`. A failed request is logged and never fails the stage change. Nothing is requested while the settings are unpublished, `enabled` is false, or the job is not at Reviewing.

The task does nothing (no Jev request, no fetch) when the settings are off, the job is gone, archived or not at Reviewing. On a second request with the same posting and policy it reuses the saved gaps and form and only drafts what is still pending; if there is nothing new it returns `already-checked` without writing. It saves only while the job is still at Reviewing on the same posting, and keeps anything Bernardo did while it ran (dismissed or asked gaps, approved or skipped answers).

## Gaps

Jev (`jev-posting-gaps`) answers four boolean questions (`GAP_QUESTIONS` in `lib/posting-check.js`): does the posting state the pay; where the role is based and the working pattern; the seniority or team size; the contract terms or eligibility. Its input is the company, role, saved location, location mode and salary, the description, and, when an ATS API was read, the facts it publishes (salary range, location, commitment, workplace type). A topic is a gap when Jev's probability that it is stated is below `gapThreshold`.

When there are gaps, a small `gpt-6.1-sol` call at low effort (`writeGapNote`, a durable model call like the review note) writes JSON `{ <kind>: { why, question } }` from the posting, with Bernardo's short personal facts (location, sponsorship, availability) in the private context. Each field must be plain text of at most 200 characters with no markup or links; a question must end with "?". Anything invalid or a failed call keeps the templated text in `GAP_TEMPLATES`. If Jev fails or answers incompletely, the check is saved with `gapStatus: "unavailable"` and `status: "partial"`; re-run tries again.

## Application forms

`lib/ats-forms.js` recognises posting and apply URLs (the job's `sourceUrl` first, then the first supported link in its description or notes):

| System | URLs | Public API used | Questions |
| --- | --- | --- | --- |
| Greenhouse | `boards.greenhouse.io/{board}/jobs/{id}`, `job-boards.greenhouse.io/…`, the `eu.` variants, `boards.greenhouse.io/embed/job_app?for={board}&token={id}` | `GET boards-api[.eu].greenhouse.io/v1/boards/{board}/jobs/{id}?questions=true&pay_transparency=true` | Yes: custom questions, with select options. Contact fields, uploads and the EEO/demographic sections are left out. |
| Lever | `jobs[.eu].lever.co/{site}/{uuid}[/apply]` | `GET api[.eu].lever.co/v0/postings/{site}/{uuid}` | No: the public API does not publish custom questions. Salary range, location, commitment and workplace type feed the gap check. |
| Ashby | `jobs.ashbyhq.com/{board}/{uuid}[/application]` | `GET api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true` | No: Ashby's application form API needs an API key. Compensation, location and employment type feed the gap check. |

The request URL is built in code from the parsed target, never taken from a payload. Each read is an `ats-form-request` child task (one HTTP attempt per task attempt, `retry.fetch` with retries off, up to 3 task attempts with backoff, `Retry-After` honoured through `catchError`, 404/410 treated as "posting gone", other 4xx not retried). A failed read never fails the check: the form is saved as `unavailable`.

For any other site, or for the questions a Lever or Ashby form asks, Bernardo pastes the questions (one per line; list markers and numbering are removed; a trailing `*` or `(required)` marks a required question; contact fields are dropped). A pasted form is kept across later checks and is never replaced by a fetched one.

### Drafting answers

Answers use the existing writer (`runAnswer` in `lib/answer.js`, a durable model call), with `economy: true`, the job's fit page, description and steering instructions, and the answers he has already approved for this job as prior context. There is no second answer generator. Drafting waits until the fit page exists (`draftStatus: "waiting-for-fit"`), and at most `maxDraftAnswers` questions are drafted per job.

- **Personal questions** (salary expectation, notice period or start date, right to work or visa, relocation or office attendance, equal-opportunity and background questions, how he heard about the role) are never sent to the writer. They are flagged `needsYou: true` with a reason. When an exact published profile fact matches (for example "Do you have the right to work in the UK?"), its answer is offered as the draft, still for his approval.
- A refusal from the writer (`CANNOT ANSWER:`), a failed draft or a question over the limit is flagged `needsYou: true` with the reason. These are not redrafted on later automatic runs; re-run tries them again.

## Saved on the job

`postingCheck`, stored with the job's runtime fields (Sanity `appState`) and exposed as `postingCheck` (or null) in job summaries and details:

```js
{
  status: "checked" | "partial",           // partial: gaps or form could not be read
  policy: "2026-10-29-posting-1",
  checkedAt: "ISO time",
  draftStatus: "" | "waiting-for-fit" | "drafted" | "off",
  gaps: [{ id, kind, label, why, question, state }],      // kind: salary | location | seniority | contract
                                                         // state: open | dismissed | asked
  form: {
    source: "" | "greenhouse" | "lever" | "ashby" | "pasted",
    url: "public posting URL",
    status: "ready" | "no-questions" | "unavailable" | "not-detected" | "off",
    questions: [{ id, text, required, options, answerDraft, needsYou, reason, state }]
                                                         // state: pending | drafted | approved | skipped
  }
}
```

Internal fields stay out of the API: `fingerprint`, `gapStatus`, `model`, `noteModel`, `form.facts`, and per-item `limit`, `askedAt`, `approvedAt`.

`postingCheckProgress(job)` (pure, in `lib/posting-check.js`) gives the inputs for "Ready to apply": `{ checked, status, openGaps, formQuestions, answersToApprove, answersNeedingYou, answersWaiting, answersReady }`. `answersReady` is true when no form question is pending or drafted (all approved or skipped, or there are none).

## Needs you

`GET /api/admin/jobs?needsYou=1` items now include, after the agent review items (which keep their exact shape and have no `kind`), one item per Reviewing job for each of:

```js
{ kind: "posting-gaps", id, company, role, score, location, checkedAt,
  gaps: [{ id, kind, label, why, question }] }             // open gaps only

{ kind: "application-answers", id, company, role, score, location, checkedAt, source,
  questions: [{ id, text, required, options, answerDraft, needsYou, reason }] }
                                                           // drafted, or pending and needing him
```

Posting items are sorted by score, highest first. `needsYouCount` in the jobs list counts them too.

## Actions

All are `POST /api/admin/jobs` with the admin secret, and return `{ job }` (the job summary with `postingCheck` and `questions`) unless noted. Unknown ids return 404, bad input 400, a job without a check 409.

| `action` | Body | Effect |
| --- | --- | --- |
| `dismiss-gap` | `{ id, gapId }` | Gap state `dismissed`. |
| `draft-gap-question` | `{ id, gapId, question? }` | Stores the recruiter question (edited text, at most 300 characters, or the suggested one) and sets state `asked`. No email is sent or drafted. |
| `paste-questions` | `{ id, text }` | Replaces the form with the pasted questions (keeping states of questions with the same text) and requests a drafting run. Returns `{ job, requested }`; `requested` is false while the check is off. |
| `approve-answer` | `{ id, questionId, answer? }` | Approves the draft, or the edited `answer` (at most 8,000 characters). Saves it as application question `pc_<questionId>` on the job (replacing an earlier approval of the same question) and sets state `approved`. |
| `skip-answer` | `{ id, questionId }` | State `skipped`: the question no longer waits on him. |
| `rerun-posting-check` | `{ id }` | Forces a new check (refetches, re-runs Jev, retries refused drafts; keeps his states). Returns 202 `{ requested, runId }`; 409 while the check is off or the job is not at Reviewing. |

## Settings

`fit-analysis-settings.postingCheck` is published policy. Changing it does not mark fit assessments outdated.

| Field | Rule | Default |
| --- | --- | --- |
| `enabled` | boolean | `false` |
| `gapThreshold` | number, 0.1–0.9 | `0.5` |
| `fetchApplicationForms` | boolean | `true` |
| `draftAnswers` | boolean | `true` |
| `maxDraftAnswers` | integer, 0–20 | `8` |
| `requestTimeoutSeconds` | integer, 5–60 | `20` |

While the object is unpublished no posting is checked. An invalid published value fails settings loading with `SANITY_SETTINGS_INVALID`. The canonical Studio field is `lib/sanity/studio/postingCheck.ts`; add `postingCheck` to the Analysis settings document in the Jev group, beside `reviewAgent`.

## Rollout

1. Deploy the app and the Trigger worker (the new tasks are `check-posting` and `ats-form-request`).
2. Seed the defaults once (disabled), preserving any published value and existing drafts:

   ```sh
   node --env-file=.env.local scripts/seed-posting-check.mjs          # dry run
   node --env-file=.env.local scripts/seed-posting-check.mjs --apply  # adds the defaults where missing
   ```

3. Set `enabled` to true in Studio and publish. Jobs moved to Reviewing from then on are checked; for a job already at Reviewing, use re-run.

## What it costs

Per job reaching Reviewing (October 2026 prices in `lib/usage.js`):

- **Jev gap check**: four boolean questions over the posting (up to about 6k input tokens at $0.042 per million): well under $0.001.
- **Gap note**: only when there are gaps. `gpt-6.1-sol`, low effort, about 5–6k input and under 1k output tokens: about $0.01–0.02.
- **Form read**: free public APIs, one request per check.
- **Answer drafts**: the existing writer's cost per question, about $0.02–0.05 each (routine "why us" questions can route to the cheaper compact path). Personal questions cost nothing. With a typical 3–5 custom questions that is about $0.10–0.25; `maxDraftAnswers` (8) caps it at about $0.40.

So roughly **$0.02 per job without a form** and **$0.10–0.30 with a Greenhouse or pasted form**. Automatic runs happen at most twice per posting (before and after the fit page); re-runs and new pastes add one each.
