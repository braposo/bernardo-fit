# Approved pipeline design implementation

The approved design from [mockup PR #7](https://github.com/braposo/bernardo-fit/pull/7) is implemented on PR #6.

- Top navigation; independently scrolling job list and reading pane on desktop; list/detail navigation on mobile.
- Separated, fully clickable job cards with right-aligned score tiles, named color-coded stages, document availability and relative added times with exact-date titles.
- Real saved posting link beneath the score; icon-only status editor using shadcn Popover and NativeSelect.
- Overview, Documents, Role details, Activity tabs using shadcn Tabs. Existing materials/context URL values remain compatible.
- Document Cards expose live version, model and creation time. Open and generate actions are adjacent; shadcn Collapsible exposes saved versions with authenticated preview and Publish live actions. Expanded history survives refreshing after publication.
- Shared muted primary actions; semantic colors, keyboard focus, privacy labels and stale-output warnings retained.

The [free AdminCN template](https://github.com/shadcnstudio/shadcn-nextjs-admincn-admin-template-free) informed card spacing, metric hierarchy and mail-style browsing. Compositions use the app's existing Radix shadcn components instead of importing the template's Base UI implementation.

## Validation

- `npm run build`.
- `npm run test:admin-ui`: 51 checks, including automated axe WCAG A/AA scans and responsive widths 1280, 768, 390 and 360.
- `node tests/test-ui.mjs`: 49 checks.
- `node tests/test-versions.mjs`: 57 checks.
- `node tests/test-edittitle.mjs`: 23 checks.
- `node tests/test-models.mjs`: 51 checks.
- `git diff --check`.

Browser verification uses synthetic API fixtures and dispatches no paid generation. Desktop/mobile screenshots were visually reviewed. PR CI remains the authoritative full-suite validation.

## Publication decision

The mockup proposed generating an unpublished draft. Existing PR #6 generation automatically makes successful outputs live; this remains unchanged pending the user's explicit choice between these behaviors. The server-backed review accurately explains automatic publication, and previous versions can be selected explicitly. No worker or publication contract is silently changed in this UI update.
