# Filtered jobs

The admin's **Filtered** view lists roles the automatic screens scored and kept out of the pipeline, with the reason and fit scores, and moves one into the pipeline on request. It works like a spam folder: check it, rescue anything worth a look, then **Clear all**.

## What is recorded

- **Below threshold** and **Constraint conflict** (`below-threshold`, `constraint-conflict`): any ingest batch (daily discovery or a manual import) that scored a role and did not admit it. The cleaned posting, including its description, and the full Jev assessment are kept.

Roles that never get a score are not recorded: cards the title screen skips (a confident mismatch from the card alone) and postings that could not be read. Evaluation and summary failures are retried by their batch and are not recorded either. Records with the older `title-mismatch` and `needs-review` decisions may still exist; they are listed and move like any other.

Each posting is one `filteredJob` document with ID `filtered-job.<pipeline id>`, using the same identity the pipeline uses, so a later screen of the same posting refreshes the record. Recording is best effort: a storage failure is counted in the run metadata (`filteredRecordFailures`) and does not fail the batch.

## Moving a role into the pipeline

**Move to pipeline** creates the job at New with the saved posting fields, description and assessment, and marks the record as moved (`movedAt`, `movedJobId`). It then starts the `filtered-job-enrich` task so the role reaches the same level as roles the screens admitted:

- When no description was saved (title-screened and backfilled records), the `filtered-job-description` child fetches the public LinkedIn posting. It takes the discovery source lock, so it never overlaps a daily scan; while a scan holds the lock it fails and Trigger retries with a backoff of 2 to 20 minutes, up to six attempts. Each LinkedIn request is a single attempt so the lock is never held through a provider cooldown.
- The full Jev assessment and overview summary then run, exactly as **Assess fit** does.

Progress is tracked on the job's `jevRun`, so the pipeline and toasts show it as a fit assessment. Nothing starts when Jev is not configured. If the posting has gone or LinkedIn fetching is paused, the run fails with a message and the role stays at New with its link; add the description in Role details and use Assess fit. An existing pipeline or archived row for the same posting is reused rather than duplicated, and a moved record is never revived by a later screen.

## Clearing the list

**Clear all** asks for confirmation, then sets `clearedAt` on every record the open list was loaded with (`filteredAt` at or before the list's `listedAt`), so a role filtered while the list is open stays. Cleared records are hidden from the list but kept: repost matching still sees them, so a later listing of a cleared job is noted on its record (`reposts`, `lastSeenAt`) instead of being assessed again and reappearing. A later screen of the same posting does not bring a cleared record back. Retention deletes cleared records like any other.

## Retention

`fit-analysis-settings.filteredJobRetentionDays` (7–365) is published policy. After each daily discovery run, records last filtered longer ago than this are deleted (moved records included; their pipeline jobs are unaffected). If the field is unpublished nothing is removed. Seed it once, preserving any published value:

```sh
node --env-file=.env.local scripts/seed-filtered-job-retention.mjs          # dry run
node --env-file=.env.local scripts/seed-filtered-job-retention.mjs --apply  # adds 90 days where missing
```

## Studio

The canonical schema is `lib/sanity/studio/filteredJob.ts`. In the standalone Studio, register `filteredJob` as a read-only type excluded from creation templates and document actions, and add `filteredJobRetentionDays` to the Analysis settings Jev group beside the minimum admission score. The app writes these documents whether or not the Studio type is deployed.
