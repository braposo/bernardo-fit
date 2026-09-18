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
