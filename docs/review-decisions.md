# Review decisions

When Bernardo moves a job out of **New**, the admin records his call and why. The records build a history of what he advances and what he drops, so a future review agent can learn from them and, later, suggest a call before he makes his.

## What is recorded

Every stage change from `new` to any other stage saves one `reviewDecision` document, whether or not reasons were given. Moves between later stages, edits that do not change the stage, and moves back to New are not recorded.

| Field | Meaning |
| --- | --- |
| `_id` | `review-decision.<job id>.<decidedAt in ms>` |
| `jobId`, `company`, `role`, `source`, `sourceUrl` | The job as saved after the move |
| `score` | The job's Jev fit score, or null when it has none |
| `fromStage`, `toStage` | `new`, then the stage it moved to; for an undone agent move, the agent's stage and where Bernardo put the job (the same stage when he restored it from Archive) |
| `direction` | `advance` (Reviewing, Applied, Interviewing, Offer), `drop` (Not interested) or `other` (Rejected, Expired) |
| `reasons[]` | Up to 5 reasons, each 1–60 characters, deduplicated case-insensitively |
| `note` | Optional free text, up to 1,000 characters |
| `agentLean`, `agentProbability` | The [review agent](review-agent.md)'s lean on the job (`advance`, `drop` or `ask`) and its probability for the direction chosen (null for `other`); both null when the job had no suggestion |
| `decidedBy` | `bernardo`, or `agent` for the review agent's own [automatic move](review-agent.md#automatic-moves). Missing on older records, which are his. Agent records never count towards agreement, examples or learned reasons |
| `overridesAgent` | True when Bernardo undid an automatic move; always counted as a disagreement |
| `decidedAt` | ISO time of the move |

The admin sends reasons with the stage change: `PATCH /api/admin/jobs?id=<id>` with `{ "stage": "not_interested", "decision": { "reasons": ["Too hands-on"], "note": "" } }`. An invalid `decision` returns 400 and nothing is saved. The pre-move stage is read inside the guarded job write, so concurrent moves cannot record twice. Recording never fails the stage change: if the write fails, the response's `generationErrors` says "The stage was saved, but the reason could not be recorded." Records are written once and never edited.

Without Sanity storage (`SANITY_CONTENT_ENABLED` unset: tests and offline development) records stay in memory.

## Quick-pick reasons

`GET /api/admin/jobs?reviewReasons=1` returns `{ advance: [...], drop: [...] }`: the published picks for each direction, then up to five reasons used most often in earlier decisions for that direction that are not already listed (compared case-insensitively). While the settings are unpublished, only learned reasons are offered.

`fit-analysis-settings.reviewReasons` is published policy: `advance` and `drop`, each 1–12 unique, non-empty reasons of up to 60 characters. Changing them does not mark fit assessments outdated. Seed the defaults once, preserving any published value:

```sh
node --env-file=.env.local scripts/seed-review-reasons.mjs          # dry run
node --env-file=.env.local scripts/seed-review-reasons.mjs --apply  # adds the defaults where missing
```

| List | Defaults |
| --- | --- |
| `advance` | Strong management fit, Right stack, Location works, Interesting product, Good salary |
| `drop` | Too hands-on, Not a management role, Commute or office days, Salary too low, Wrong seniority, Industry not a fit, Agency or duplicate |

## Studio

The canonical schemas are `lib/sanity/studio/reviewDecision.ts` and `lib/sanity/studio/reviewReasons.ts`. In the standalone Studio, register `reviewDecision` as a read-only type excluded from creation templates and document actions, and add `reviewReasons` to the Analysis settings document in the Jev group beside the minimum admission score. The app reads and writes these whether or not the Studio schemas are deployed.
