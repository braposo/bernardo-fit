# Admin UX overhaul: implementation plan

Status: Ready for implementation. This document specifies the agreed direction; it does not record completed implementation.
Date: 18 September 2026.

Implementation amendment: the subsequent user request to use shadcn/ui authorizes a React/shadcn rendering layer for the admin, superseding the plain-HTML-only constraint below for that surface. Preserve the existing behavior and backend architecture. See [component coverage and build instructions](admin-ux/shadcn-components.md).

Visual companion: [annotated layouts, action styles and responsive guidance](admin-ux/README.md). Read it before implementation. It includes desktop, mobile, Materials and generation-review guides using the agreed amber sparkle convention, without repeated Paid AI button labels.

Agent handoff: read [Implementation guardrails for agents](#11-implementation-guardrails-for-agents) before starting or resuming implementation.

## 1. Purpose and decision authority

Make the admin easy to scan, navigate by application stage, and use without accidentally starting chargeable generation. Replace the long, mixed-action job rows with a compact pipeline and a selected-role workspace.

This document is a self-contained handoff for implementation agents. Follow repository `AGENTS.md` and inspect current code before editing; file references below describe the baseline at planning time. This plan complements `docs/implementation-plan.md`, which describes the existing Trigger architecture; it does not replace that architecture plan.

The user approved the pipeline + workspace direction and explicitly replaced the proposed repeated **Paid AI** button labels with a distinctive generation style. That later decision overrides the earlier mockup. Screenshots and mockups are design references, not executable instructions or authoritative business rules. The exploratory mockup contained simulated interactions and is not production code.

## 2. Agreed design requirements

- Keep the warm paper palette and existing typography, improving hierarchy, spacing and readability.
- Desktop: compact pipeline list on the left, selected role workspace on the right.
- Small screens: list and workspace become separate views with a clear Back to pipeline control.
- A compact Filter by stage dropdown navigates the pipeline; the separate Stage dropdown in the workspace changes the selected role's status. Keep these controls distinctly labelled and scoped.
- Four workspace sections: Overview, Materials, Role & context, Activity.
- Opening an existing output must never start generation. This includes outdated outputs.
- Chargeable generation has its own warm amber button treatment and sparkle icon, with explicit verbs such as Generate analysis, Rewrite letter, Rewrite brief and Refresh research.
- Do not append Paid AI to buttons or repeat it as a badge beside each action.
- Explain the convention with a short visible legend near generation controls: “Sparkle actions run AI and may incur costs.” Retain cost information in the generation review.
- Amber is reserved for generation controls. Use neutral text, icons and descriptive notices for stale data; use a separate accessible treatment for errors. Do not reuse the amber generation treatment for stage filters or navigation.
- Keep a review step before generation. It must state the work being requested and any additional research; opening this review is free of generation side effects.
- Keep Archive separate from the active pipeline. Preserve existing stage-driven archiving rules.

### Action vocabulary and appearance

| Action category | Appearance | Examples | Behaviour |
| --- | --- | --- | --- |
| Navigate/read | Blue text link; one prominent blue opening shortcut is acceptable on Overview | Open letter, View fit page, Open brief, View posting | Reads or navigates only; use real links where appropriate |
| Edit/local utility | Neutral button or standard form control | Save, Copy link, Edit details, Change stage | No AI dispatch |
| Generate | Amber surface, sparkle icon, explicit verb | Generate analysis, Rewrite letter, Draft answer, Refresh research | Opens review, then dispatches only after explicit submission |
| Manage record | Separate neutral actions; destructive red for permanent deletion | Archive, Restore, Delete permanently | Preserve existing lifecycle rules and shared-link behaviour |

Do not rely on colour alone. Combine appearance with icon, explicit verb, nearby explanation and an accessible description. Use the same convention in bulk actions and question-answer controls. Hover tooltips must not contain the only explanation of cost.

## 3. Verified baseline and implementation map

The frontend currently uses plain HTML and native JavaScript. Keep that approach unless a concrete requirement demonstrates a need to change it; no framework migration is part of this work.

| Files | Relevance |
| --- | --- |
| `public/admin.html` | Layout, styles, pipeline rendering, filters, editing and action handlers |
| `public/admin-run.js` | Existing run watching and recovery; reuse rather than replacing the lifecycle |
| `public/admin-usage.js` | Existing usage presentation |
| `public/letter.html`, `public/brief.html` | Existing document readers; preserve private access and opening behaviour |
| `api/admin/jobs.js`, `lib/job-view.js` | List/detail/search contracts and job mutations |
| `api/admin/cover.js`, `lib/task-policy.js`, `lib/run-receipts.js` | Generation admission, task kinds, idempotency and run receipts |
| `api/admin/versions.js` | Version listing and activation |
| `lib/screen-work.js`, `lib/generation-fingerprint.js` | Research reuse, freshness and output attachment |
| `lib/brief-inputs.js`, `lib/brief.js` | Notes and other inputs used by interview preparation |
| `lib/usage.js` | Recorded usage and cost; inspect available attribution before designing history |

Important baseline facts:

1. Stage values currently include `new`, `reviewing`, `applied`, `interviewing`, `offer`, `rejected`, `not_interested`, `expired`. The API may supply stage and archive rules. Use that source of truth, not the illustrative Interested label from earlier discussion.
2. `expired`, `rejected` and `not_interested` currently trigger archiving. Preserve this unless separately requested.
3. The existing Cover letter handler can ask whether to rewrite; cancelling opens the saved letter. Replace this with separate Open letter and Rewrite letter controls.
4. The current screen control opens a fresh brief but can generate when missing or stale. Split reading from updating; allow the old brief to open with a stale notice.
5. Rewrite brief can choose a larger preparation operation when research is stale. The review must disclose and constrain the actual operation.
6. Private notes already contribute to brief context. “Private” means not publicly displayed, not excluded from AI processing. Keep notes separate from explicit AI instructions and explain the actual use. Do not silently remove notes from existing prompts.
7. List responses intentionally omit large detail fields, while search can cover deeper content. Preserve compact loading and current search coverage.
8. Existing tests sometimes extract functions or strings from `admin.html`. If functions move, update tests to exercise their new location; do not delete behavioural coverage just to accommodate a refactor.

## 4. Pipeline navigation contract

### Filters, counts and search

- Replace wrapping stage chips with one Filter by stage dropdown above the compact role list. Include All stages and every relevant stage with its count in the options; show the selected stage and its count in the closed control.
- Use two compact control rows in the narrow pipeline: full-width search, then the single stage dropdown. Place them side by side only where both remain legible. Do not add a separate Filters button unless additional filter types actually exist.
- Keep search and the stage dropdown sticky within the list pane while entries scroll. On mobile keep the compact controls visible during list scrolling without covering focused entries; preserve the existing scroll-restoration contract.
- Remove the separate matching-roles count line; the dropdown already shows that count. Do not replace the chip rows with another tall filter panel.
- Use API-provided stages. Active and archived views follow their own allowed stage sets.
- Search combines with the selected stage. Preserve existing searchable fields and server-supported search behaviour.
- Counts describe matches within the current active/archive collection and search, before applying the selected stage. All is the total for that same collection and search. Compute counts through the appropriate data contract; do not claim full counts from a partial loaded page.
- Distinguish loading, an empty pipeline, an empty stage and no search results. Offer Clear search or All stages where appropriate.
- Preserve the existing best-fit-first ordering initially. Sorting redesign is outside scope.

### Role selection and history

- Use stable job IDs, never list indices, for selection.
- Encode collection, stage, search, selected role and workspace section in URL state using a documented query/hash scheme. Never put credentials, private view tokens, notes or descriptions in the URL.
- Back/Forward and reload restore that state; store list scroll position locally per relevant view. Search typing should replace history rather than create a history entry per keystroke.
- Selecting another role keeps the stage, search and list position. Preserve the current workspace section when useful across roles.
- When a stage edit removes the selected role from the filtered list, retain its workspace with a notice that it no longer matches and an explicit return to the list. Do not unexpectedly open another role. Archiving follows the same rule.
- Missing or inaccessible selected IDs show an appropriate empty state and route back to the pipeline; do not display stale data from the previously selected role.
- Filters must never patch a job. The role's stage dropdown must never silently change the pipeline filter.

### Compact role row

Use a compact two-line baseline: company and fit score on the first line, role on the second. Omit repeated stage labels when a specific stage is selected; show stage in All stages or mixed-stage views. Allow additional height for long titles and genuine attention indicators, preserving readable type and touch targets. Include only actionable indicators such as reply owed, active generation or missing analysis. Keep long rationales, engagement metrics, editors and generation toolbars out of the list. Use a labelled selection control and visible selected/focus states.

## 5. Workspace information architecture

Keep company, role title, location/work pattern, salary when available and stage control in the role header. Make empty fields understandable; do not invent values. Keep title and company editing available.

| Section | Content and actions |
| --- | --- |
| Overview | Fit assessment and accessible score explanation, concerns, reply-owed context, stale-analysis notice, shortcuts to existing materials and engagement summary |
| Materials | Fit analysis, cover letter, interview brief, company research and application questions; output status and separate reading/generation controls |
| Role & context | Role/company editing, full job description, source/posting/email links, private notes and explicit AI instructions |
| Activity | Available run outcomes and recorded costs, engagement details and version history grouped by output |

### Materials

- Each output has a stable name, availability/freshness status and relevant metadata. Put model and generation date in secondary metadata rather than the role title line.
- Existing output: Open and the appropriate rewrite/update action. Missing output: clear empty state and Generate with prerequisites explained. Running: show status and retain Open for the previous version.
- Copy fit link belongs beside the fit page. Keep public/shared versus private output distinctions explicit.
- Application questions show question text, word limit, saved answer, word count, copy, draft/rewrite and delete actions. Separate editing a question from generating its answer.
- Put View versions beside its material, opening the matching Activity group. Version activation is an explicit mutation; previewing a version must not activate it.

### Forms and saving

- Use persistent labels, readable text sizes and useful editor widths, not placeholder-only fields or tiny uppercase summaries.
- Show Saving, Saved and Couldn't save states beside the edited field.
- Keep unsaved text on failures; provide retry. Handle fast role switches and late responses without applying text to another job.
- Preserve or explicitly resolve pending changes before leaving a role. Saving instructions or job descriptions must not trigger AI.
- Explain which outputs become outdated after input changes, using existing freshness logic.
- Avoid entire-workspace rerenders while a user is typing; retain focus, cursor and drafts across progress updates.

## 6. Generation review and dispatch contract

All generation entry points, including bulk analysis and drafting answers, use the shared review pattern. No live generation should be used merely to verify UI wiring.

The review includes:

1. Role/output being updated, or explicit list/count for a bulk operation.
2. Model selection using existing allowed models and reusable defaults. Move the global model selector out of the pipeline toolbar. Retain the routine-answer economy preference in relevant generation settings.
3. Relevant input summary, saved versus pending edits, and the operation's prerequisites.
4. Whether existing research will be reused or refreshed, including any extra generation that implies.
5. What happens to the current output, active version and any shared fit page. Inspect existing replacement semantics and describe them accurately; do not promise draft-only publication if that is not implemented.
6. A reliable cost range if supported. Otherwise say the estimate is unavailable and that the action may incur costs. Recorded historical cost must not be presented as a guaranteed quote.
7. Cancel and an amber, sparkle-marked submit button with a specific verb. No repeated Paid AI suffix.

### Server enforcement

- Inspect existing admission and orchestration before choosing a minimal contract change. Reuse the existing task kinds, receipts, fingerprint checks and Trigger lifecycle.
- A read-only review/preflight may be needed to resolve effective scope. It must not queue work, call an AI model, fetch paid research or mutate an active version.
- The final request carries reviewed scope and sufficient version/fingerprint information to detect relevant changes. The server validates it against current inputs and research reuse policy.
- If freshness or inputs changed and require broader work, stop and require a refreshed review. Never silently upgrade a reviewed brief-only operation to research plus brief.
- Bulk review must identify the reviewed job set, not merely a count that can change between review and dispatch. Newly eligible jobs must not be silently included.
- Preserve request IDs and duplicate-submission recovery. A deliberate new generation gets a new ID; retrying an uncertain dispatch recovers the same one.
- Keep existing run recovery after reload and duplicate-click protections. Failed, paused, superseded and partial outcomes must remain distinguishable where the backend supplies them.
- Do not invent cost estimates, job history, cancellation support or run progress that the backend does not expose. Add only the minimum required API changes; document limits explicitly.

## 7. Accessibility, privacy and responsive behaviour

- Keyboard users can filter, select a role, switch sections, edit, review and submit. Use semantic navigation or fully implemented tabs, with correct selected state and focus behaviour.
- Review dialogs need focus entry, focus trapping, Escape/Cancel handling and focus return. Do not auto-focus disruptive updates from run polling.
- Announce meaningful save/run changes through restrained live regions. Do not announce every poll.
- Verify text, border and focus contrast; the sparkle icon and verb must communicate generation without colour.
- Keep critical controls visible on touch, with appropriate target sizes and no reliance on hover.
- Verify approximately 360–390 px mobile, 768 px intermediate and 1280 px desktop widths. Avoid horizontally scrolling action rows or squeezed two-column mobile layouts.
- Preserve authenticated admin access, private artifact token handling, safe external links, output escaping and public/private data boundaries.
- Never put credentials or private generated content in PR screenshots or browser fixtures.

## 8. Work packages and integration order

Implement in focused PRs on dedicated `codex/` branches. Do not merge without explicit user instruction. The assigned implementation lead owns integration and ensures each intermediate PR is usable.

### PR 1 — Pipeline and workspace foundation

Owner: frontend/navigation agent.

- Inventory existing controls and record their destination in the new layout so none disappear.
- Implement navigation state, compact role list, filters/counts/search, responsive selection and four workspace sections.
- Relocate existing editing and reading capabilities. Separate ambiguous open/generate handlers as soon as they move; never introduce a misleading opening control as a temporary step.
- Introduce shared action styling, including the amber sparkle convention and legend.
- Extract small native JavaScript modules where useful, without building a new frontend framework or duplicating state.
- Add targeted navigation/selection regressions and update affected UI tests.

Exit: all roles remain discoverable by stage/search; existing functionality has a predictable home; reading never dispatches generation; navigation survives Back/reload.

### PR 2 — Generation review and scope guarantees

Owners: generation/API agent and frontend integration owner, with agreed file ownership.

- Define the review/submit contract before editing both sides.
- Resolve research reuse and bulk scope using server truth; add minimal enforcement where existing contracts are insufficient.
- Implement the shared review, model defaults, economy preference and truthful cost presentation.
- Connect every generation action, including application answers and bulk analysis.
- Retain receipts, idempotency, reload recovery and previous-output access during work.

Exit: all generation requires explicit reviewed submission; no scope escalation or extra bulk jobs can be dispatched silently.

### PR 3 — Activity, resilience and final UX verification

Owner: frontend/activity agent, with integration review.

- Consolidate supported run history, costs, engagement and output-grouped versions.
- Finish save-error recovery, outdated/missing/running/failed states, archive/restore/delete flows and accessibility.
- Validate the complete desktop/mobile journeys and resolve CI regressions.

Exit: acceptance matrix below passes and all existing action families remain usable.

### Agent coordination rules

- This handoff does not require parallel agents. If work is delegated, use explicit ownership and bounded tasks.
- `public/admin.html` is currently shared and monolithic. Avoid simultaneous edits to it; let one integration owner make shell changes or extract agreed modules first.
- API contract investigation and fixture/test planning can proceed independently of shell work. Integration depends on the agreed contract, not guesses on either side.
- Each handoff reports changed files, contract changes, targeted checks, screenshots when appropriate, known limitations and remaining work.
- Load relevant Trigger.dev skills before changing any task, orchestration or realtime code, as required by `AGENTS.md`.

## 9. Validation plan and acceptance matrix

Use the smallest relevant checks per change. Existing tests are standalone Node scripts, for example `node tests/test-ui.mjs`. Select tests based on touched behaviour rather than running every file below each time. Full local `npm test` is not the default; PR CI is authoritative.

| Behaviour | Required acceptance | Candidate existing coverage |
| --- | --- | --- |
| Stage/search navigation | One stage dropdown replaces chip rows; selected count is not repeated; controls stay visible during list scroll; row stage labels appear only for mixed-stage views; filtering does not mutate; counts/search/history remain correct | `test-search.mjs`, `test-counts.mjs`, `test-ui.mjs`; add focused URL-state tests |
| Opening materials | Open letter/brief/research/fit and version previews produce zero generation dispatches, even when stale | `test-ui.mjs`, `test-stale.mjs`, `test-link.mjs`; add mocked dispatch assertions |
| Paid generation | Review opens without dispatch; Cancel dispatches nothing; submit dispatches once with reviewed scope | `test-admin-run.mjs`, `test-screen.mjs`; add contract cases |
| Scope changed during review | Stale research/input changes and newly eligible bulk jobs cannot silently expand the operation | `test-screen.mjs`, relevant release/task tests; add explicit race cases |
| Editing | Saved/error states are truthful; failed edits retain text; late saves cannot update the wrong role; saving never generates | `test-jd.mjs`, `test-instructions.mjs`, `test-edittitle.mjs`, `test-jobs.mjs` |
| Questions | Edit, word limit/count, draft, copy and delete remain available and correctly scoped | `test-questions.mjs`, `test-ui.mjs` |
| Lifecycle | Manual/automatic archive, restore and delete preserve expected public-link behaviour | `test-archive.mjs`, `test-autoarchive.mjs`, `test-dismiss.mjs` |
| Versions and costs | Preview versus activation is distinct; costs come from recorded usage with truthful missing states | `test-versions.mjs`, `test-usage.mjs`, `test-cost.mjs` |
| Running work | Previous outputs stay readable; reload recovers running work; duplicate submit cannot create another run | `test-admin-run.mjs`, relevant receipt/task tests |
| Accessibility/mobile | Keyboard and dialog focus work; long titles/forms and filters fit narrow screens | Browser verification with representative local fixtures |

Manual/browser scenarios must include: a role without analysis, the supplied Sanity-style interviewing role with existing materials, stale research/brief, unanswered and answered questions, running/failed work, no search matches and an archived role. Use mocked generation or deterministic fixtures for dispatch verification.

Before each PR: run `git diff --check`, report exact targeted commands and outcomes, then inspect PR checks. Fix CI failures on the feature branch and allow CI to rerun. A docs-only handoff does not require application tests.

## 10. Completion and scope boundaries

The overhaul is complete when every existing admin action is accounted for, pipeline navigation works by real status, all four sections are usable, opening is always distinct from generation, amber sparkle actions consistently disclose their meaning, and the acceptance matrix is satisfied.

Out of scope unless separately requested: framework migration, new status taxonomy, Kanban board, new AI models, changing scoring/prompts, new billing system, speculative cost estimator, new task lifecycle engine, changing sharing/publication semantics, or redesigning public fit pages.

Do not stop at a visual shell with unwired controls. Conversely, do not expand this UX project into unrelated architecture work. Record unavailable history or estimates honestly, and implement only the backend changes necessary for the agreed behaviour.

## 11. Implementation guardrails for agents

These guardrails apply across all work packages and future agent handoffs. They supplement the requirements and acceptance matrix above; they do not replace repository instructions or later explicit user decisions.

1. **Use the written plan as the implementation authority.** Wireframes illustrate layout and hierarchy. Sample roles, counts, dates, model placeholders and annotation text must not become production data or product copy. Preserve backend business rules; if a guide conflicts with this plan, follow the written requirement and record the discrepancy.

2. **Inventory existing actions before moving them.** Maintain a reviewable mapping of current action, new section/control, handler or API, and verification evidence. Include application questions, version preview/activation, archive/restore/delete, copy/share links, source links and bulk operations. Mark an action complete only when it remains reachable and works in its applicable states. Do not silently drop less-visible controls during the redesign.

3. **Keep one source of navigation state and handle late responses.** Derive filters, URL state, selected job and workspace section from one coherent state model. Associate requests with stable job IDs and request versions. A stale role-detail or search response must not replace the current view. A save or run response for a previously selected role may update that role's stored state, but must not overwrite another role's fields or display its feedback as belonging to the current role. Verify rapid role/filter changes and out-of-order responses.

4. **Preserve in-progress interaction during background updates.** Do not rebuild the workspace while someone is typing. Save acknowledgements, polling and run completion must preserve draft text, focus, cursor/selection and scroll. Never replace newer edits with an older server response. Keep failed saves recoverable without requiring the user to retype their work.

5. **Prove generation boundaries using mocked requests.** Assert zero generation dispatches when opening outputs, filtering/searching, editing/saving, opening or cancelling a review, or previewing versions. Confirm that an explicit generation submission dispatches only the reviewed operation and job set, with duplicate submission recovery. Use mocks or deterministic fixtures; do not incur live generation costs merely to test UI wiring.

6. **Preserve behavioural coverage during refactors.** If layout/module changes invalidate tests that inspect markup or extract functions, replace those checks with meaningful coverage at the new boundaries. Do not remove tests or weaken assertions simply to obtain passing CI. Record the replacement coverage for changed test assumptions, especially action reachability, mutation scope and generation side effects.

7. **Verify density with realistic content.** Exercise long company/role names, missing fields, mixed stages, attention indicators and enough entries to require scrolling. Compare visible entries at the same viewport before and after the change. Compact layout must not rely on unreadably small text, clipped essential labels, tiny touch targets or sticky controls covering focused rows. Preserve wrapping where needed and show stage metadata in mixed-stage views.

8. **Report incomplete work explicitly.** Each PR or agent handoff must list implemented behaviours, changed contracts, exact checks and outcomes, and remaining limitations. Identify unwired controls, unavailable backend capabilities, unverified states and failing checks. Screenshots support review but are not proof of functional completion; do not report the overhaul complete until the acceptance matrix and applicable PR checks pass.
