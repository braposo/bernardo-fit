# PR #6 implementation review

Reviewed against `../admin-ux-implementation-plan.md` and the visual guide on 18 September 2026.

Follow-up: the requested shadcn integration now supplies the shared admin controls and Radix dialog/tab behavior. See [component coverage and build instructions](shadcn-components.md). The expanded browser suite passes 39 checks and includes automated accessibility scans; CI now builds the component assets and runs that suite.

## Corrections

- Long pipeline entries now contain their text and scroll independently on desktop. Mobile retains the sticky filter block and a single pane. Stage controls use neutral colours; amber is reserved for generation.
- Search retains keyboard focus and selection after responses, collection requests reject obsolete responses, and Back to pipeline always returns to the list. Scroll positions are stored against the view that actually rendered them.
- Context and question drafts survive section/role changes and failed saves within the current page session. Generation review refuses pending edits. Background refreshes preserve a focused editor's DOM. Save feedback uses live regions.
- Section tabs implement arrow keys, Home/End, roving focus and panel relationships. Generation controls include accessible cost descriptions; bulk generation also has a visible legend.
- Version previews load actual content through an authenticated, read-only GET. They do not activate versions. Responses are private/no-store and project only output content. Source links accept only HTTP(S).
- Research and brief runs recover their watchers after reload. Previous outputs remain openable. Private outputs and analysis prerequisites are labelled.

## Action inventory

| Action family | Location / implementation | Evidence |
| --- | --- | --- |
| Search, stage filter, select, Back | Pipeline and navigation handlers | UI/search tests; browser search focus, long entries, mobile Back |
| Stage mutation, archive, restore, delete | Header Stage; Activity record management; existing jobs API | Existing lifecycle coverage in PR CI |
| Open fit, copy fit link | Overview / Materials; link and clipboard handlers | UI action coverage |
| Open saved letter, research, brief | Materials; token requests and existing readers | Browser asserts zero generation dispatches for stale outputs |
| Context and question editing | Labelled editors; jobs PATCH | Editing/question tests; browser failed draft retention |
| Question draft, copy, remove, add | Materials question controls | Question/UI tests; shared generation review |
| Single and bulk generation | Materials / pipeline; shared review and cover API | Generation review tests; browser cancel and explicit submit assertions |
| Version preview and activation | Activity groups; versions GET / POST | Version tests verify historical content, ownership, authentication and no mutation |
| Run recovery, engagement, usage | Existing run watcher; Overview / Activity | Run watcher tests and existing CI |

## Verification

Targeted commands run successfully:

- `node tests/test-ui.mjs` — 52 assertions
- `node tests/test-versions.mjs` — 57 assertions
- `node tests/test-questions.mjs` — 50 assertions
- `node tests/test-edittitle.mjs` — 23 assertions
- `node tests/test-search.mjs` — 23 assertions
- `node tests/test-generation-review.mjs` — 6 assertions
- `node tests/test-admin-run.mjs` — 15 assertions
- `node scripts/verify-admin-ux.mjs` — 19 browser assertions
- `git diff --check`

The optional browser script requires Playwright (local installation or `NODE_PATH`). `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select installed Chrome; `ADMIN_UX_SCREENSHOTS` optionally selects an existing screenshot directory. It serves local files, uses synthetic jobs and intercepts every API request. No live generation is performed. Widths: 1280, 768, 390 and 360 pixels. Desktop and mobile screenshots were inspected, including a long company name, multiline title, missing salary, stale outputs and a saved question.

The full suite is left to PR CI, per repository instructions. Browser fixtures do not prove live provider availability or production data correctness. Draft recovery is in memory within the current page, not a persistent offline store. Activity and estimates remain limited to backend-provided run and usage data; no future cost estimates or cancellation capability are invented.
