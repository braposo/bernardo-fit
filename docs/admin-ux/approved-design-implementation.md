# Approved pipeline design implementation

The approved design from [mockup PR #7](https://github.com/braposo/bernardo-fit/pull/7) is implemented on PR #6.

- Top navigation; independently scrolling job list and reading pane on desktop; list/detail navigation on mobile.
- Separated, fully clickable job cards with right-aligned score tiles, named color-coded stages, document availability and relative added times with exact-date titles.
- Real saved posting text link at the bottom of the job header; icon-only status editor using shadcn Popover and NativeSelect.
- Overview, Documents, Role details, Activity tabs using shadcn Tabs. Existing materials/context URL values remain compatible.
- Document Cards expose live version, model and creation time. Open and generate actions are adjacent; shadcn Collapsible exposes saved versions with authenticated preview and Publish live actions. Expanded history survives refreshing after publication.
- Shared muted primary actions; semantic colors, keyboard focus, privacy labels and stale-output warnings retained.

The [free AdminCN template](https://github.com/shadcnstudio/shadcn-nextjs-admincn-admin-template-free) informed card spacing, metric hierarchy and mail-style browsing. Compositions use the app's existing Radix shadcn components instead of importing the template's Base UI implementation.

## Validation

- `npm run build`.
- `npm run test:admin-ui`: 55 checks, including automated axe WCAG A/AA scans and responsive widths 1280, 768, 390 and 360.
- `node tests/test-ui.mjs`: 49 checks.
- `node tests/test-versions.mjs`: 57 checks.
- `node tests/test-edittitle.mjs`: 23 checks.
- `node tests/test-models.mjs`: 55 checks.
- `git diff --check`.

Browser verification uses synthetic API fixtures and dispatches no paid generation. Desktop/mobile screenshots were visually reviewed. PR CI remains the authoritative full-suite validation.

## Publication decision

Successful generation automatically makes the new version live, as confirmed by the user. The current version stays readable while generation runs, and previous versions remain available for preview and explicit publication. Existing worker and publication contracts are preserved; private documents remain private.

## Instructions for an individual version

The generation dialog places an optional shadcn Textarea beneath the model selector, replacing the previous input/publication/cost paragraphs. Up to 4,000 characters of additional instructions are appended to the job's generic instructions for this request only. Changing these instructions requires a refreshed review; switching models retains the draft. A changed request gets a fresh idempotency ID.

The reviewed task payload carries the additional instructions through fit, letter, research, brief and combined research/brief generation. Workers check the combined input against current job state without writing instructions back to the job. Version metadata stores the additional text; authenticated history offers an Additional instructions disclosure. Public fit report bodies exclude that metadata. Successful generation still publishes automatically.

Validation includes 55 browser/accessibility checks, 9 focused instruction-lifecycle checks, 7 reviewed-dispatch checks, and the existing screen (26), version (57), rendering (49) and cost (36) tests. Changed Trigger task bundles compile without deployment. Release must deploy the updated Trigger workers alongside the application so they consume the new optional payload field.


## Score gauges and job audit trail

Overview now uses three shadcn Card + ChartContainer radial gauges for Location,
AI / Developer experience, and Leadership. Each uses the stored 0–100 rating
(with a truthful unassessed state) and shows its 35% / 35% / 30% weighting.
Analytics and the Activity shortcut have moved out of Overview.

Activity presents analytics first, a newest-first audit log with exact local timestamps,
then inline AI activity and usage for this job. Older events are paginated; Refresh
activity loads new events. The global navigation's usage view remains aggregate usage.

Audit streams are private and retained independently from capped document versions
and expiring run receipts. Job and fit-version events are written atomically with
state changes. Events cover creation, status, archive/restore/delete, edited fields,
run transitions, version generation/publication/preview/open, question changes and
answers, public fit views/link copies/CV download requests, listing opens, admin
copies, and signed document print requests. No prompts, note bodies, viewer identities,
or signed tokens are saved in the audit log. Print events record opening the dialog,
not a confirmed PDF save. Anonymous engagement remains client-reported analytics.

Legacy creation dates are shown as historical evidence; earlier unrecorded actions
cannot be reconstructed and are clearly disclosed. New per-job AI usage persists
beyond the global rolling history, including linked public-analysis usage. Historical
unattributed AI calls are not silently included or attributed to the wrong job.
Deploy the updated Trigger.dev workers with the app to enable job/report attribution.

Validation: 69 browser checks including gauge semantics, mobile overflow, escaped
log content, pagination, inline shadcn usage tables and automated WCAG A/AA checks;
focused audit, atomic-store, versions, jobs, usage, UI and generation-instruction tests.


### Generation history compatibility and compact Activity rows

Activity also reads retained fit/letter/research/brief versions and saved terminal
run/answer timestamps. This recovers generation evidence written by independently
deployed older workers, with duplicates suppressed against recorded audit events.
Unknown generation dates and historical publication dates are never inferred.
Recovery is limited to retained source records; deleted historical versions cannot
be reconstructed. New worker audit events remain the durable historical record.

Analytics always uses three columns, including mobile. Audit rows are one line:
local date and time first, then the action name. Long names truncate visually while
keeping the complete text accessible; supporting details remain in the row title.
Inline AI usage follows the log as before.

Validation: 73 browser checks, 14 audit tests, 10 generation lifecycle tests
(including all four document types through the Activity endpoint), 57 version tests
and 49 UI contract tests. The final screenshot was visually reviewed.
