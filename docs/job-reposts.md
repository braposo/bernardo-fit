# Reposts of existing jobs

Employers and recruiters often repost an opening under a new LinkedIn listing, and job sites found through JSearch (JobLeads, WhatJobs, JobMESH and others) carry the same opening under a rewritten title, often with only a short summary of the description. Daily discovery and manual imports recognise these and record them on the job Bernardo already has, instead of adding a new row and paying for another assessment.

## How a repost is recognised

Every new posting is compared with the pipeline, the archive and the Filtered list (moved records excluded; they are pipeline jobs now). The same listing id is not a repost: the pipeline's exact match and the filtered record's own identity already handle it.

1. **Rules.** Same company (ignoring legal and country suffixes such as Ltd, LLC, SAS, Group or UK, a "via" prefix and anything in brackets, so "Turnitin, LLC", "Pigment SAS" and "Google (via hackajob)" match) and the same title (ignoring punctuation and case), with a compatible place: the same city, or either listing is country-wide, remote or "Anywhere". The rule settles a repost only when the descriptions also match (at least 80% of their distinct longer words shared) or one side has no saved description. Recruiters reuse generic titles such as "Engineering Manager" for different clients, so a rule match whose descriptions differ goes to Jev instead. In discovery a rule match skips the title screen and goes straight to the description fetch and this check, so it costs no title-screen call or assessment. A reworded title over the same description (80% shared words) is also settled by the rules, unless it is the same title in another city.
2. **Jev, for close calls.** Same company with the same title in a different city, or a title that shares at least a quarter of its words once job-site noise is removed ("Remote", "Hiring:", "(Permanent)", "(m/f/d)", "... Job in Islington"). The bar is low on purpose: "Remote Engineering Manager, AI-Driven Editing Experience" on JobLeads is Lokalise's "Engineering Manager" on LinkedIn. Unrelated roles at the same company (for example "Senior Software Engineer II" and "Engineering Lead") still stay apart. After the description is fetched, and before any assessment, Jev compares the new posting with up to `maxComparisons` of the closest existing records, using their saved descriptions. Each side is sent with its `source` and a `descriptionKind` (`full`, `summary` under 1,500 characters, or `missing`), and the instructions tell Jev that a summary naming the same team, product or responsibilities is the same opening: only conflicting details make it different. A record counts as the same opening only when Jev chooses `repeat` with at least `repeatProbability`.

If the Jev comparison fails, the posting is reported as `repeat-check-failed` and stays pending for the next scan; it is never assessed unchecked.

## What is recorded

- **Pipeline or archived job:** the listing is appended to the job's `reposts` (kept in its app state; up to 20, one per listing) with its link, title, location, visible posting date, when it was seen and whether the rules or Jev matched it. Stage, archive state, link and assessment are unchanged.
- **Filtered job:** the listing is appended to the record's `reposts` and `lastSeenAt` is set. Retention counts from `lastSeenAt` when present, so a role that keeps being reposted stays in Filtered rather than expiring and being reassessed.

Discovery reports repeats in `report.repeats` and the run metadata `repeats`; ingest batches return `repeated` and `repeatedRows`.

## Settings

`fit-analysis-settings.duplicateCheck` holds the Jev instructions, the two criteria, `repeatProbability` (0.5–1) and `maxComparisons` (1–8). While it is unpublished only the rules run. Seed it once, preserving any published value:

```sh
node --env-file=.env.local scripts/seed-duplicate-check.mjs          # dry run
node --env-file=.env.local scripts/seed-duplicate-check.mjs --apply  # adds the defaults where missing
```

The November 2026 wording (summaries and other job sites) replaces the October text with a separate script, which leaves any field edited in the Studio alone:

```sh
node --env-file=.env.local scripts/update-duplicate-check-prompt.mjs          # dry run
node --env-file=.env.local scripts/update-duplicate-check-prompt.mjs --apply
```

The Studio field is `lib/sanity/studio/duplicateCheck.ts`; add it to the Analysis settings Jev group beside `filteredJobRetentionDays`. The `filteredJob` type in `lib/sanity/studio/filteredJob.ts` now includes `reposts` and `lastSeenAt`.
