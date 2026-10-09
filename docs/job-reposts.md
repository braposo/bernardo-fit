# Reposts of existing jobs

Employers and recruiters often repost an opening under a new LinkedIn listing. Daily discovery and manual imports recognise these and record them on the job Bernardo already has, instead of adding a new row and paying for another assessment.

## How a repost is recognised

Every new posting is compared with the pipeline, the archive and the Filtered list (moved records excluded; they are pipeline jobs now). The same listing id is not a repost: the pipeline's exact match and the filtered record's own identity already handle it.

1. **Rules, from the search card.** Same company (ignoring suffixes such as Ltd/Limited and a "via" prefix) and the same title (ignoring punctuation and case), with a compatible place: the same city, or either listing is country-wide or remote. Discovery applies this before the title screen, so a rule repost costs no Jev call, LinkedIn description request or assessment.
2. **Jev, for close calls.** Same company with the same title in a different city, or a title that shares at least half its words (for example "Software Engineering Manager" and "Engineering Manager"). After the description is fetched, and before any assessment, Jev compares the new posting with up to `maxComparisons` of the closest existing records, using their saved descriptions. A record counts as the same opening only when Jev chooses `repeat` with at least `repeatProbability`.

If the Jev comparison fails, the posting is reported as `repeat-check-failed` and stays pending for the next scan; it is never assessed unchecked.

## What is recorded

- **Pipeline or archived job:** the listing is appended to the job's `reposts` (kept in its app state; up to 20, one per listing) with its link, title, location, visible posting date, when it was seen and whether the rules or Jev matched it. Stage, archive state, link and assessment are unchanged.
- **Filtered job:** the listing is appended to the record's `reposts` and `lastSeenAt` is set. Retention counts from `lastSeenAt` when present, so a role that keeps being reposted stays in Filtered rather than expiring and being reassessed.

Discovery reports rule and Jev repeats in `report.repeats` and the run metadata `repeats`; ingest batches return `repeated` and `repeatedRows`.

## Settings

`fit-analysis-settings.duplicateCheck` holds the Jev instructions, the two criteria, `repeatProbability` (0.5–1) and `maxComparisons` (1–8). While it is unpublished only the rules run. Seed it once, preserving any published value:

```sh
node --env-file=.env.local scripts/seed-duplicate-check.mjs          # dry run
node --env-file=.env.local scripts/seed-duplicate-check.mjs --apply  # adds the defaults where missing
```

The Studio field is `lib/sanity/studio/duplicateCheck.ts`; add it to the Analysis settings Jev group beside `filteredJobRetentionDays`. The `filteredJob` type in `lib/sanity/studio/filteredJob.ts` now includes `reposts` and `lastSeenAt`.
