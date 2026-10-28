# Review agent

After a job is admitted at **New**, the review agent suggests what Bernardo should do with it: move it forward, drop it, or ask him one short question. It learns from his [review decisions](review-decisions.md): the reasons he gave on the most similar jobs he moved forward or dropped are the examples it reads.

## Shadow mode

The agent never changes a stage. Its suggestion is saved on the job and shown in the admin's **Needs you** queue. When Bernardo moves the job out of New, the `reviewDecision` he records carries the agent's lean, so the app can report how often he agreed. `autoAdvance` and `autoDrop` exist in the settings for a later release; they are validated and have no effect yet.

## When it runs

The `review-job` Trigger task (payload `{ jobId }`) is triggered:

- by ingestion (`executeIngestBatch`: daily LinkedIn and JSearch scans, imports), for each job it newly admits at New;
- by `executeJevWork` whenever a fit assessment completes on a job at New. That covers a job moved from Filtered once its assessment finishes, and **Assess fit** on a New job, which re-reviews it.

The idempotency key is `review-job:<job id>:<fingerprint>:<assessedAt>:<REVIEW_POLICY>`, global scope, kept 30 days, so each assessment is reviewed once per policy: a re-assessment or a policy bump is reviewed again. A failed trigger is logged and never fails the ingest or the assessment. Nothing is triggered while the settings are unpublished or `enabled` is false.

The task does nothing (and makes no Jev request) when the settings are unpublished or disabled, the job no longer exists, is archived or not at New, has no saved assessment, or already has a current review (same assessment and same `REVIEW_POLICY`). A review written under an older policy is outdated and is redone even when the assessment is unchanged. It saves its result only while the job is still at New on the same assessment. The Jev request is a durable model call: the provider task owns HTTP retries and the answer is reused if the final write is retried.

## What Jev is asked

Jev's input is the candidate profile and Bernardo's per-job preferences and notes (as for fit scoring), the job (company, role, location, salary, description), the saved assessment (score, status, each dimension's score and confidence, posting quality, hard-constraint check) and up to `exampleCount` past decisions. Examples are the most similar earlier `advance` and `drop` decisions: same company scores 3, title word overlap up to 2, score closeness up to 1, newest first on ties. Each example carries the company, role, score, whether he moved it forward or dropped it, his reasons and up to 300 characters of his note.

Three questions:

| Key | Type | Question |
| --- | --- | --- |
| `advance` | boolean | Would Bernardo move this job forward to Reviewing? |
| `drop` | boolean | Would he drop it as Not interested without reviewing it further? |
| `reason` | choice | Which of his reasons (published quick picks, then the reasons he has used most) is the main one for his call? Left out when fewer than two reasons exist. |

The prompts are in `lib/review-agent.js` (`REVIEW_QUESTIONS`, `reasonQuestion`, `REVIEW_NOTE_PROMPT`), versioned by `REVIEW_POLICY` (currently `2026-10-29-review-2`). Bump it whenever a prompt or rule changes, then run the backfill with `--refresh`.

## The written note

Jev returns only probabilities and choices, so a second, small call writes the text. Once the lean is known, `writeReviewNote` asks `gpt-6.1-sol` at low reasoning effort (the same path as overview summaries: `lib/openai.js` through `durableModelCall`, so the provider task owns retries and the result is checkpointed) for JSON `{ reason, question }`:

- `reason`: one sentence naming the most decisive concrete fact behind the call (place and office days, salary, team size, stack, seniority, hands-on share, industry). Used for every lean.
- `question`: only for an ask. One question naming a concrete fact from this posting that settles the call, such as "The posting asks for 4 office days in Manchester; is that a deal-breaker?". It asks about a flagged constraint first, then what his past decisions turn on, then the biggest unknown.

Its input is the lean, the job and description, the assessment summary, the constraint flags and the same past decisions Jev saw. The candidate profile goes in the private system context only, after the fixed prompt, so the shared prefix is cached across jobs. Posting text and notes are marked untrusted data. Each field is checked: a non-empty string of at most 200 characters with no markup or links, and a question must end with "?". A field that fails, an empty answer or a failed call keeps the templated text below; the review itself never fails because of the note. Expected cost is about $0.02–0.03 per review (around 9–12k input tokens, most of it the cacheable profile, and under 1k output tokens).

## Result rules

- **advance** when the forward probability is at least `advanceThreshold` and the hard-constraint check raises no flag. A flag is a `conflict` choice, a conflict probability of 0.2 or more, or a blocked assessment.
- **drop** when the drop probability is at least `dropThreshold`.
- **ask** otherwise, including when both probabilities pass their thresholds (the answers contradict).

Without a written note, the reason is a templated sentence (for example "Likely a drop. Main reason: Too hands-on.") and an ask has a templated question, such as `Does "Too hands-on" outweigh "Right stack" here?` or "Is the possible constraint conflict a deal-breaker for this one?". Both are at most 200 characters. The candidate profile is never saved or shown.

## Saved on the job

`agentReview`, stored with the job's other runtime fields and exposed as `agentReview` (or null) in job summaries and details:

| Field | Meaning |
| --- | --- |
| `lean` | `advance`, `drop` or `ask` |
| `advanceProbability`, `dropProbability` | Jev's probabilities, rounded to 3 decimals |
| `reason` | One plain sentence, at most 200 characters |
| `question` | Only for `ask`, otherwise empty; at most 200 characters |
| `reviewedAt` | ISO time |
| `model` | The Jev model that answered |
| `examples` | How many past decisions were shown |

Three internal fields stay out of the API: `assessment` (the assessment key the review read), `policy` (the `REVIEW_POLICY` it was written under) and `noteModel` (the writer model, empty when the templated text was used).

## Needs you and agreement

`GET /api/admin/jobs?needsYou=1` returns `{ items, agreement }`:

- `items`: every job at New, not archived, with a suggestion, as `{ id, company, role, score, location, lean, advanceProbability, dropProbability, reason, question, reviewedAt }`. Asks come first, then drops, then advances; highest score first within each.
- `agreement`: over the latest 1,000 review decisions whose `agentLean` is `advance` or `drop` and whose direction is `advance` or `drop`: `decided` (count), `agreed` (lean matched direction) and `rate` (agreed / decided to 2 decimals, or null when nothing was decided). Asks and other moves (Rejected, Expired) are left out.

The jobs list (`GET /api/admin/jobs`) also returns `needsYouCount`, the number of items.

When a review decision is recorded, `agentLean` is the job's `agentReview.lean` and `agentProbability` is its probability for the direction Bernardo chose (`advanceProbability` for advance, `dropProbability` for drop, null for other moves). Both are null when the job has no suggestion.

## Settings

`fit-analysis-settings.reviewAgent` is published policy. Changing it does not mark fit assessments outdated.

| Field | Rule | Default |
| --- | --- | --- |
| `enabled` | boolean | `false` |
| `advanceThreshold` | number, 0.5–0.99 | `0.85` |
| `dropThreshold` | number, 0.5–0.99 | `0.85` |
| `autoAdvance` | boolean, not used yet | `false` |
| `autoDrop` | boolean, not used yet | `false` |
| `exampleCount` | integer, 0–10 | `5` |

While the object is unpublished no job is reviewed. An invalid published value fails settings loading with `SANITY_SETTINGS_INVALID`. Seed the defaults once (disabled), preserving any published value and existing drafts:

```sh
node --env-file=.env.local scripts/seed-review-agent.mjs          # dry run
node --env-file=.env.local scripts/seed-review-agent.mjs --apply  # adds the defaults where missing
```

Then set `enabled` to true in Studio and publish.

## Backfill

To review jobs already at New:

```sh
node --env-file=.env.local scripts/review-new-jobs.mjs          # dry run: lists job ids
node --env-file=.env.local scripts/review-new-jobs.mjs --apply  # triggers review-job for each
node --env-file=.env.local scripts/review-new-jobs.mjs --refresh --apply  # also redoes reviews from an older policy
```

It picks every job at New with a saved assessment and no `agentReview`; `--refresh` also picks those whose `agentReview.policy` is not the current `REVIEW_POLICY`. It refuses `--apply` while the agent is disabled. It uses the same idempotency key as the automatic hook, so repeating it is safe. Run it with the Trigger key for the environment that should do the work.

## Studio

The canonical field is `lib/sanity/studio/reviewAgent.ts`. In the standalone Studio, add `reviewAgent` to the Analysis settings document in the Jev group, beside `reviewReasons`. The app reads it whether or not the Studio schema is deployed.
