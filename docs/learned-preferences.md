# Learned preferences

Once a week the app reads Bernardo's recent [review decisions](review-decisions.md) and proposes short, plain-language rules about how he decides, such as "London roles need two office days a week or fewer." A proposed rule waits in **Needs you** and does nothing until he accepts it, as written or in his own words. Only accepted rules reach the [review agent](review-agent.md), as part of its input.

## When it runs

The `learn-preferences` Trigger scheduled task runs every Monday at 07:00 London time, in **Production** only (like the other schedules). It needs persistent storage and published Sanity analysis settings, and does nothing (no model call) when:

- `reviewAgent.learnPreferences` is false or missing (`outcome: "disabled"`);
- fewer than 10 of Bernardo's recent decisions qualify (`"too-few-decisions"`);
- nothing was decided since the last run, judged by the newest decision it read (`"no-new-decisions"`).

A qualifying decision is one Bernardo made himself (`decidedBy` is not `agent`), moved the job forward or dropped it, and has at least one reason or a note. The task reads the newest 400 decisions and uses up to the 150 newest that qualify.

## What the model is asked

One call to `gpt-6.1-sol` at low reasoning effort, through `lib/openai.js` and `durableModelCall`, as for the review note: the provider task owns retries, and the answer is checkpointed so a retried final write does not pay twice. The fixed prompt is `LEARN_PREFERENCES_PROMPT` in `lib/review-preferences.js`.

Its input:

- `decisions`: each qualifying decision as `{ ref, decision, company, role, score, location, locationMode, salary, reasons, note }`. `ref` is `d1`, `d2` and so on; location, mode and salary come from the job when it still exists; notes are cut to 300 characters.
- `existingRules`: every stored rule (proposed, accepted or rejected) with its current wording, so the model does not propose them again.

It returns JSON `{ "rules": [{ "text", "decisions": ["d1", "d4"] }] }`. Each rule is checked: plain text of at most 200 characters on one line, with no markup or links, backed by at least two refs that were in the input. Refs are mapped back to `reviewDecision` ids. At most 5 rules are kept per run; anything else is dropped. Posting text, reasons and notes are marked as untrusted data in the prompt.

**Cost.** About 150 decisions at roughly 60–80 tokens each, plus the prompt and existing rules, is 10–14k input tokens and under 1k output tokens: similar to one review note, around $0.02–0.05 per run, so about $0.10–0.20 a month. Weeks with no new decisions make no call.

## Duplicates

A new proposal is skipped when it matches a stored rule in any state, including a rejected one or Bernardo's edited wording, or another proposal in the same run. Two rules match when their words overlap almost completely (at least 80% of the combined set of words). A rejected rule is never proposed again. A **deleted** rule is gone and can be proposed again later; reject it instead to stop that.

## Stored in Sanity

One `reviewPreferences` document with `_id` `review-preferences`. Writes are revision-guarded; a concurrent change is re-read and reapplied (up to 5 times, then 409).

| Field | Meaning |
| --- | --- |
| `rules[]` | Each `{ _key, id, text, state, sourceDecisionIds, createdAt, decidedAt, editedText? }` |
| `rules[].id` | `rule-<hash of the rule's words>`, also the array `_key` |
| `rules[].state` | `proposed`, `accepted` or `rejected` |
| `rules[].sourceDecisionIds` | The `reviewDecision` ids the rule came from |
| `rules[].editedText` | Bernardo's wording, when he edited it; the agent reads this instead of `text` |
| `lastLearnedAt` | When learning last saved proposals |
| `lastDecisionAt` | The newest decision the last run read |

Without Sanity storage (tests and offline development) the document lives in memory.

## Admin API

Served by `/api/admin/jobs` (the hosting plan allows no new functions), admin secret required.

| Request | Body | Response |
| --- | --- | --- |
| `GET ?preferences=1[&state=proposed\|accepted\|rejected\|all]` | | `{ rules, lastLearnedAt }`, newest first |
| `POST` | `{ action: "accept-preference", id }` | `{ rule }` |
| `POST` | `{ action: "reject-preference", id }` | `{ rule }` |
| `POST` | `{ action: "edit-preference", id, text }` | `{ rule }`: saves his wording and accepts it |
| `POST` | `{ action: "delete-preference", id }` | `{ deleted: id }` |

A rule in responses is `{ id, text, state, sourceDecisionIds, createdAt, decidedAt, editedText? }`. Accept works on proposed and rejected rules; reject on proposed and accepted ones (a rejected rule keeps any edit); repeating the current state is 409. A missing rule is 404, an unknown action or invalid text 400.

## Needs you

`GET /api/admin/jobs?needsYou=1` lists proposed rules after the review suggestions and email status proposals, newest first:

```json
{ "kind": "preference-proposal", "id": "rule-…", "text": "London roles need two office days a week or fewer.",
  "sourceDecisionIds": ["review-decision.…"],
  "sources": [{ "id": "review-decision.…", "jobId": "…", "company": "Acme", "role": "Engineering Manager", "direction": "drop" }],
  "createdAt": "2026-11-02T07:00:03.000Z" }
```

`sources` names the source decisions still among the latest 1,000; older ones are only in `sourceDecisionIds`. The jobs list's `needsYouCount` includes these items. A failed read leaves them out rather than failing the list.

## Switching it on

```sh
node --env-file=.env.local scripts/seed-review-agent.mjs          # dry run: lists missing fields
node --env-file=.env.local scripts/seed-review-agent.mjs --apply  # adds learnPreferences: false (and the auto-move gates)
```

Then set `learnPreferences` to true in Studio and publish. To try it before Monday, trigger `learn-preferences` from the Trigger dashboard with the environment's key. Accepted rules change the review agent's input for reviews made from then on; jobs already reviewed are not reviewed again until their assessment or `REVIEW_POLICY` changes.

## Studio

The document type is `lib/sanity/studio/reviewPreferences.ts` (read-only; exclude it from creation templates and document actions). The `learnPreferences` switch is in `lib/sanity/studio/reviewAgent.ts`. The app reads both whether or not the Studio schema is deployed.
