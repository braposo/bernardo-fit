# Fit content import

Destination: private Sanity project `quli96gc`, dataset `production`.
The connected branch reads and writes Sanity when `SANITY_CONTENT_ENABLED=1`.
Production continues using Redis until its coordinated app/worker activation.
Merging this PR alone does **not** switch production storage. The importer is a
historical transfer utility; it is not required for normal app reads or writes.

## Result — 22 September 2026

The authenticated production export was taken at 20:05 UTC. We imported 493 content
documents plus the existing public CV PDF. The previously published Analysis
settings singleton was left unchanged.

| Content | Imported |
| --- | ---: |
| Candidate profile / evidence sections | 1 / 8 |
| Jobs (including 85 archived) | 132 |
| Jev assessments | 130 |
| Application questions and answers | 22 |
| Current reports / historical versions / demo | 77 / 79 / 1 |
| Cover letters, including legacy versions | 34 |
| Company research | 2 |
| Interview briefs | 5 |
| Homepage and CV pages | 2 |

Validation: zero schema errors or warnings; zero missing reference targets; all
493 stored payloads matched the generated content, including their complete
source recovery copies. A repeat import left the first 491 documents unchanged
and created only the two newly added homepage/demo documents. Six jobs have no
company in the source; their provenance flags this rather than inventing a name.

This verifies the exported content, **not a complete database migration**.

The runtime follow-up restored nine report dismissals omitted by the original
export, after verifying complete source inventories and zero adoptable reports.
The repaired branch reports zero unlinked analyses. New exports include
`dismissedReportIds`, and the transform preserves them. The guarded repair is
`node --env-file=.env.local migration/scripts/restore-dismissed-reports.mjs`;
it defaults to a dry run, and `--apply` backs up affected documents before writing.

All 130 assessments and 55 stored Overview summaries were imported. Original
scoring fingerprints are recognized only for unchanged migrated content and
unchanged role inputs. This restores the same 39 current active scores and eight
stale active assessments as the source app, without recomputation or relabeling
outdated results as current.

## Missing pieces before cutover

- Production KV credentials are marked sensitive in Vercel, so `env pull` returns
  placeholders. Add `KV_REST_API_URL` and `KV_REST_API_READ_ONLY_TOKEN` to the
  ignored `.env.migration.local`, then run the raw extractor below. Do not commit
  credentials or paste them into task messages.
- The existing export only enumerates indexed reports/jobs. The artifact preview
  API returns projected content. A raw scan must find orphaned/unindexed records,
  artifacts outside the retained version indexes, full generation provenance,
  brief confirmed answers, and task input/result checkpoints. Compare those with
  this import and extend the transform before claiming complete coverage.
- Already deleted/expired history cannot be recovered from the current database.
- Dynamic labels, loading/error messages and admin interface copy remain in code.
  The homepage body, demo report, CV and analysis instructions are in Sanity;
  remaining interface copy needs an explicit editable model if it is in scope.
- Job/artifact read-write adapters, concurrency guards, draft handling and shared
  report reads are connected on this branch. The live storage probe exercises
  these through the app storage layer and Trigger development worker. Hosted
  branch generation requires Trigger Preview setup. Static home/CV renderers
  still need wiring. Redis locks, run receipts, usage, audit and rate limiting
  remain operational data in Redis, isolated by namespace on the branch.
- Before enabling Sanity storage after merge: pause content writes, extract and
  import a final delta, verify active pointers and shared links, test generation
  and edits, then enable the coordinated web/worker configuration. Keep snapshots
  and Redis available for rollback. Existing report IDs and URLs are preserved.

## Reproduce

Run from `fit-app` with real, locally held credentials:

```powershell
node --env-file=.env.local migration/scripts/export-admin.mjs
node --env-file=.env.local migration/scripts/export-artifacts.mjs
# Complete database snapshot, once read-only access is available:
node --env-file=.env.migration.local migration/scripts/extract.mjs
```

The artifact preview endpoint records its normal preview audit events. It does
not change content or activate versions. The raw extractor only reads Redis.
Raw snapshots, generated documents and detailed reports are all gitignored.
The raw scan is a live traversal, not an atomic snapshot; use a write freeze and
repeat comparison at final cutover. The current transformer consumes the admin
exports; raw KV reconciliation is deliberately not claimed as implemented.

Run from the standalone sibling `studio-fit-app`:

```powershell
node scripts/transform-content.mjs
npm run typegen
npx sanity documents validate --file ../fit-app/migration/transformed/content.ndjson --yes
npx sanity schemas deploy
npx sanity exec scripts/import-content.mjs --with-user-token
```

For source-backed migration records the importer uses stable hashed IDs,
following the migration skill's repeatability rule. Source IDs remain in
`legacyId`/`versionId` and `migration.sourceKey`; relationships are actual Sanity
references. Newly authored ordinary content can use Sanity-generated IDs.
Owned arrays have stable keys. Research citations retain their numeric source
keys. Rich text is converted to Portable Text, including legacy cover HTML.

The importer backs up the destination before writing, creates dependency shells,
then fills documents with revision guards. It refuses documents edited outside
the importer and refuses unpublished drafts. It does not delete destination
documents or overwrite Analysis settings. A failed/uncertain run can be resumed
from the same snapshot. Review any conflicts instead of forcing an overwrite.

Full source JSON is retained in a hidden read-only `sourcePayload` recovery field;
structured fields are the editable content. This retains operational provenance
without making arbitrary JSON the canonical editor.

## Standalone Studio review source

The Studio has a separate local Git repository without a remote.
`standalone-studio.patch` is a reviewable text patch covering its schema,
configuration and migration changes from bootstrap commit `ec51460` through
`fa711dd`. The actual Studio remains exclusively in `../studio-fit-app`; no Studio
directory is embedded in this app. The sibling changes are already committed.
For a matching bootstrap checkout on another machine, run `git apply --check --unidiff-zero`
against this patch before applying it there with `git apply --unidiff-zero`, then `npm ci`. Do not apply the
patch to the app repository or reapply it to the already updated sibling.
