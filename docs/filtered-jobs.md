# Filtered jobs

The admin's **Filtered** view lists roles the automatic screens analysed and kept out of the pipeline, with the reason and any fit scores, and moves one into the pipeline on request.

## What is recorded

- **Title screen** (`title-mismatch`): LinkedIn discovery cards Jev judged a confident mismatch from the card alone. Only the card is kept (company, title, location, link, visible posting date) with the title-screen relevance. Deferred (uncertain) cards are not filtered; they stay in the discovery backlog.
- **Below threshold**, **Constraint conflict** and **Unreadable posting** (`below-threshold`, `constraint-conflict`, `needs-review`): any ingest batch (daily discovery or a manual import) that assessed a role and did not admit it. The cleaned posting, including its description, and the full Jev assessment are kept. Evaluation and summary failures are retried by their batch and are not recorded.

Each posting is one `filteredJob` document with ID `filtered-job.<pipeline id>`, using the same identity the pipeline uses, so a later screen of the same posting refreshes the record. Recording is best effort: a storage failure is counted in the run metadata (`filteredRecordFailures`) and does not fail the batch.

## Moving a role into the pipeline

**Move to pipeline** creates the job at New with the saved posting fields, description and assessment, and marks the record as moved (`movedAt`, `movedJobId`). It then starts the `filtered-job-enrich` task so the role reaches the same level as roles the screens admitted:

- When no description was saved (title-screened and backfilled records), the `filtered-job-description` child fetches the public LinkedIn posting. It takes the discovery source lock, so it never overlaps a daily scan; while a scan holds the lock it fails and Trigger retries with a backoff of 2 to 20 minutes, up to six attempts. Each LinkedIn request is a single attempt so the lock is never held through a provider cooldown.
- The full Jev assessment and overview summary then run, exactly as **Assess fit** does.

Progress is tracked on the job's `jevRun`, so the pipeline and toasts show it as a fit assessment. Nothing starts when Jev is not configured. If the posting has gone or LinkedIn fetching is paused, the run fails with a message and the role stays at New with its link; add the description in Role details and use Assess fit. An existing pipeline or archived row for the same posting is reused rather than duplicated, and a moved record is never revived by a later screen.

## Retention

`fit-analysis-settings.filteredJobRetentionDays` (7–365) is published policy. After each daily discovery run, records last filtered longer ago than this are deleted (moved records included; their pipeline jobs are unaffected). If the field is unpublished nothing is removed. Seed it once, preserving any published value:

```sh
node --env-file=.env.local scripts/seed-filtered-job-retention.mjs          # dry run
node --env-file=.env.local scripts/seed-filtered-job-retention.mjs --apply  # adds 90 days where missing
```

## Studio

The canonical schema is `lib/sanity/studio/filteredJob.ts`. In the standalone Studio, register `filteredJob` as a read-only type excluded from creation templates and document actions, and add `filteredJobRetentionDays` to the Analysis settings Jev group beside the minimum admission score. The app writes these documents whether or not the Studio type is deployed.
