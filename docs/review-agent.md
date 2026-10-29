# Review agent

After a job is admitted at **New**, the review agent suggests what Bernardo should do with it: move it forward, drop it, or ask him one short question. It learns from his [review decisions](review-decisions.md): the reasons he gave on the most similar jobs he moved forward or dropped are the examples it reads, and the [preference rules](learned-preferences.md) he has accepted are part of its input.

## Shadow mode

By default the agent never changes a stage. Its suggestion is saved on the job and shown in the admin's **Needs you** queue. When Bernardo moves the job out of New, the `reviewDecision` he records carries the agent's lean, so the app can report how often he agreed. With `autoAdvance` or `autoDrop` on, and only while the agreement gate is met, it moves confident calls itself (see [Automatic moves](#automatic-moves)).

## When it runs

The `review-job` Trigger task (payload `{ jobId }`) is triggered:

- by ingestion (`executeIngestBatch`: daily LinkedIn and JSearch scans, imports), for each job it newly admits at New;
- by `executeJevWork` whenever a fit assessment completes on a job at New. That covers a job moved from Filtered once its assessment finishes, and **Assess fit** on a New job, which re-reviews it.

The idempotency key is `review-job:<job id>:<fingerprint>:<assessedAt>:<REVIEW_POLICY>`, global scope, kept 30 days, so each assessment is reviewed once per policy: a re-assessment or a policy bump is reviewed again. A failed trigger is logged and never fails the ingest or the assessment. Nothing is triggered while the settings are unpublished or `enabled` is false.

The task does nothing (and makes no Jev request) when the settings are unpublished or disabled, the job no longer exists, is archived or not at New, has no saved assessment, or already has a current review (same assessment and same `REVIEW_POLICY`). A review written under an older policy is outdated and is redone even when the assessment is unchanged. It saves its result only while the job is still at New on the same assessment. The Jev request is a durable model call: the provider task owns HTTP retries and the answer is reused if the final write is retried.

## What Jev is asked

Jev's input is the candidate profile and Bernardo's per-job preferences and notes (as for fit scoring), the job (company, role, location, salary, description), the saved assessment (score, status, each dimension's score and confidence, posting quality, hard-constraint check), up to `exampleCount` past decisions and `learnedPreferences`, the text of every accepted [preference rule](learned-preferences.md) (his edited wording when he edited it), oldest first. Examples are the most similar earlier `advance` and `drop` decisions made by Bernardo (never the agent's own moves): same company scores 3, title word overlap up to 2, score closeness up to 1, newest first on ties. Each example carries the company, role, score, whether he moved it forward or dropped it, his reasons and up to 300 characters of his note.

Three questions:

| Key | Type | Question |
| --- | --- | --- |
| `advance` | boolean | Would Bernardo move this job forward to Reviewing? |
| `drop` | boolean | Would he drop it as Not interested without reviewing it further? |
| `reason` | choice | Which of his reasons (published quick picks, then the reasons he has used most) is the main one for his call? Left out when fewer than two reasons exist. |

The prompts are in `lib/review-agent.js` (`REVIEW_QUESTIONS`, `reasonQuestion`, `REVIEW_NOTE_PROMPT`), versioned by `REVIEW_POLICY` (currently `2026-10-29-review-3`, which added the learned preferences). Bump it whenever a prompt or rule changes, then run the backfill with `--refresh`.

## The written note

Jev returns only probabilities and choices, so a second, small call writes the text. Once the lean is known, `writeReviewNote` asks `gpt-6.1-sol` at low reasoning effort (the same path as overview summaries: `lib/openai.js` through `durableModelCall`, so the provider task owns retries and the result is checkpointed) for JSON `{ reason, question }`:

- `reason`: one sentence naming the most decisive concrete fact behind the call (place and office days, salary, team size, stack, seniority, hands-on share, industry). Used for every lean.
- `question`: only for an ask. One question naming a concrete fact from this posting that settles the call, such as "The posting asks for 4 office days in Manchester; is that a deal-breaker?". It asks about a flagged constraint first, then what his past decisions turn on, then the biggest unknown.

Its input is the lean, the job and description, the assessment summary, the constraint flags, and the same past decisions and accepted rules Jev saw. The candidate profile goes in the private system context only, after the fixed prompt, so the shared prefix is cached across jobs. Posting text and notes are marked untrusted data. Each field is checked: a non-empty string of at most 200 characters with no markup or links, and a question must end with "?". A field that fails, an empty answer or a failed call keeps the templated text below; the review itself never fails because of the note. Expected cost is about $0.02–0.03 per review (around 9–12k input tokens, most of it the cacheable profile, and under 1k output tokens).

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

After an automatic move the review also carries `autoMove` `{ stage, at, overriddenAt }`: where the agent moved the job, when, and when Bernardo undid it (empty until then). It is exposed in job summaries only once set, so older shapes are unchanged.

## Automatic moves

Off by default. After a review is saved (or, on a retry of the task, when a current review is found whose move has not happened):

1. **Switch.** `autoAdvance` on and lean `advance` (forward probability at least `advanceThreshold`, no constraint flag) moves the job to **Reviewing**; `autoDrop` on and lean `drop` moves it to **Not interested**. An ask is never moved.
2. **Gate.** Over Bernardo's latest 100 decisions that judge a confident suggestion (agent lean `advance` or `drop`, his direction `advance` or `drop`, or his undoing of an agent move), he must have agreed with at least `autoMinimumAgreement` of them, with at least `autoMinimumDecided` such decisions. Agent moves never count. While either gate field is unpublished the gate is closed and the agent stays in shadow mode. The task result says `autoMove: "gated"` with the agreement it saw.
3. **Guard.** The move is one guarded write that requires the job still at New, not archived, on the assessment the review read, with a current review of that lean and no earlier `autoMove`. Anything else (he moved it, it was re-assessed) leaves it alone (`autoMove: "superseded"`). The same write sets `agentReview.autoMove`, so a job is moved at most once, and a retried task completes a move that failed after the review was saved.

The move goes through the same path as a manual PATCH (`lib/job-update.js`, `updateJobFromBody`): audit, terminal-stage archiving, Reviewing generation (analysis, then CV) and the review decision. The audit adds `agent.moved` ("Moved by the review agent", actor `agent`) beside the usual status change. The decision has `decidedBy: "agent"`, no reasons and the agent's reason sentence as its note.

**Undo.** An auto-dropped job is in Archive at Not interested and is restored as any other ("Restore to pipeline"). An auto-advanced job can be moved anywhere. Bernardo undoes an agent move when, while the job is still at the agent's stage, he restores an auto-dropped job, or moves an auto-moved job back to New or to a stage in the other direction. That writes `agentReview.autoMove.overriddenAt`, an `agent.overridden` audit entry (actor `admin`) and one review decision with `overridesAgent: true`, which always counts as a disagreement. It is recorded once; a later call on the same job carries no agent lean, so it is not scored twice. Moving an auto-advanced job onward (Applied, Interviewing) is not a disagreement and records nothing.

Agent moves never count as agreement, so once both switches are on, the gate is fed only by Bernardo's own calls and undos, and can only close over time unless he keeps deciding jobs himself.

### Switching it on

1. Seed the gates (`scripts/seed-review-agent.mjs`, below) and publish. Check `GET /api/admin/jobs?needsYou=1`: `agreement.decided` and `rate` show roughly where the gate stands (the gate itself reads only the latest 100 scored decisions).
2. In Studio set `autoDrop` (or `autoAdvance`) to true and publish. Start with one switch and watch the Archive and the job audit for a week.
3. To stop, set the switch back to false. Moves already made stay; restore or move them back as needed.

## Needs you and agreement

`GET /api/admin/jobs?needsYou=1` returns `{ items, agreement }`:

- `items`: every job at New, not archived, with a suggestion, as `{ id, company, role, score, location, lean, advanceProbability, dropProbability, reason, question, reviewedAt }`. Asks come first, then drops, then advances; highest score first within each. Open email status proposals (`kind: "status-proposal"`) and proposed preference rules (`kind: "preference-proposal"`, see [learned preferences](learned-preferences.md#needs-you)) follow.
- `agreement`: over the latest 1,000 review decisions made by Bernardo whose `agentLean` is `advance` or `drop` and whose direction is `advance` or `drop`, plus his undone agent moves: `decided` (count), `agreed` (lean matched direction; an undone move never agrees) and `rate` (agreed / decided to 2 decimals, or null when nothing was decided). Asks, other moves (Rejected, Expired) and the agent's own moves are left out.

The jobs list (`GET /api/admin/jobs`) also returns `needsYouCount`, the number of items.

When a review decision is recorded, `agentLean` is the job's `agentReview.lean` and `agentProbability` is its probability for the direction Bernardo chose (`advanceProbability` for advance, `dropProbability` for drop, null for other moves). Both are null when the job has no suggestion, and after he has undone an agent move on that job.

## Settings

`fit-analysis-settings.reviewAgent` is published policy. Changing it does not mark fit assessments outdated.

| Field | Rule | Default |
| --- | --- | --- |
| `enabled` | boolean | `false` |
| `advanceThreshold` | number, 0.5–0.99 | `0.85` |
| `dropThreshold` | number, 0.5–0.99 | `0.85` |
| `autoAdvance` | boolean: move confident advances to Reviewing | `false` |
| `autoDrop` | boolean: move confident drops to Not interested | `false` |
| `exampleCount` | integer, 0–10 | `5` |
| `autoMinimumAgreement` | number, 0.5–1, optional: agreement the gate needs | `0.85` |
| `autoMinimumDecided` | integer, 5–100, optional: decisions the gate needs | `20` |
| `learnPreferences` | boolean, optional: run the weekly [learn-preferences](learned-preferences.md) task | `false` |

While the object is unpublished no job is reviewed. An invalid published value fails settings loading with `SANITY_SETTINGS_INVALID`. The last three fields came later: settings published without them still load, with the gate closed (no automatic move) and learning off. Seed the defaults once (disabled), preserving any published value and existing drafts; on settings that already exist it adds only the missing fields and never switches anything on:

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
