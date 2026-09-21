# Design guidance

This file consolidates the saved, agreed design decisions for future UI reviews and changes. Update it when a review establishes or replaces a reusable rule. It is guidance, not a claim that every existing screen already complies.

## Scope and decision history

The detailed rules below cover the admin pipeline and selected-job workspace. Public fit pages and document readers retain their existing design and implementation unless a task explicitly changes them; do not apply the admin redesign to them by default.

Use the latest explicit user decision. This file summarizes the current baseline from these saved sources:

- [Approved design and subsequent decisions](docs/admin-ux/approved-design-implementation.md): current layout, document cards, publication, per-version instructions, score gauges and Activity.
- [Component guidance](docs/admin-ux/shadcn-components.md): actual Radix-based shadcn components and rendering boundaries.
- [Original implementation plan](docs/admin-ux-implementation-plan.md): navigation, editing, generation safety and accessibility contracts that still apply.
- [Visual guide](docs/admin-ux/README.md) and [implementation review](docs/admin-ux/pr-6-review.md): earlier illustrations, interaction details and verification scenarios.

Later approved decisions supersede these older proposals:

| Earlier proposal | Current agreed direction |
| --- | --- |
| Plain HTML only for admin controls | React/shadcn component layer using existing Radix primitives |
| Warm paper palette, blue opening actions and amber generation buttons | AdminCN-inspired light palette and shared muted primary actions; retain Sparkles and the nearby AI-cost explanation |
| Materials and Role & context section names | Documents and Role details; preserve existing materials/context URL compatibility |
| Version groups in Activity | Expandable history beside each document |
| Analytics and an Activity shortcut on Overview | Analytics in Activity, followed by audit history and per-job AI usage |
| Input/publication/cost paragraphs in the generation dialog | Optional per-version instructions beneath the model selector, as recorded in the later approved decision |

Older wireframes illustrate intent, not current pixel specifications. Their sample companies, counts, models and annotations must not become production data or copy.

## Visual language and components

- Use the approved AdminCN-inspired light workspace: top navigation, separated job and document cards, clear metric hierarchy, restrained borders and muted primary actions. Use whitespace, headings and dividers rather than putting every sentence in a card.
- Reuse the shared tokens and existing component styles in [src/admin/styles.css](src/admin/styles.css). Its later approved-theme rules override the earlier warm-palette declarations; do not copy the old values from the wireframes. Preserve existing font assets and the current admin IBM Plex Sans typography rather than reintroducing the earlier heading-font proposal.
- Use the actual shadcn components under [src/admin/components/ui](src/admin/components/ui), not raw HTML decorated to resemble them. Keep the existing Radix implementation; the free AdminCN template provides composition inspiration, not a Base UI migration.
- Use Button for actions; labelled Input/Textarea and NativeSelect for forms; Tabs for workspace sections; Dialog for generation review; AlertDialog for destructive confirmation; Card and Collapsible for documents and history; Popover plus NativeSelect for the icon-only status editor; Table for usage.
- Use explicit action verbs: Open letter, Rewrite letter, Refresh research, Copy link, Publish live. A document name alone is not an action label. Reading, editing, generation and permanent deletion must remain distinguishable without relying on colour.
- Generation controls retain the consistent Lucide Sparkles icon and a nearby explanation: "Sparkle actions run AI and may incur costs." Do not repeat Paid AI on every button. Keep accessible descriptions and hide decorative icons from assistive technology.

## Pipeline and navigation

- Desktop has an independently scrolling job list and reading pane. Mobile uses list/detail navigation, with Back to pipeline and browser Back restoring search, stage and list position.
- Keep full-width search and one compact stage dropdown in two sticky control rows. The dropdown includes the selected count; do not add wrapping stage chips, a duplicate matching-count line or an extra Filters button.
- Search and stage combine. Counts reflect the current active/archive collection and search before stage filtering, using the real data contract. Distinguish loading, empty pipeline, empty stage and no search matches.
- Job cards are fully selectable, with company/title hierarchy, a right-aligned score tile, named colour-coded stage metadata, document availability and relative added time with an exact-date title. Allow long company and role names to wrap. Keep generation toolbars and long rationales out of the list.
- Keep stage filtering separate from editing a job's status. Filtering never mutates a job; status editing never silently changes the filter. Use the application's stages and archive rules.
- Preserve selected job, collection, stage, search and section across navigation/reload. Use stable job IDs and prevent late responses from replacing the current selection. Keep private content and credentials out of URLs.
- If a status change or archive removes the selected job from the list, retain its workspace with an explanation and a return action. Do not unexpectedly select another job. Missing or inaccessible jobs need an honest empty state.

## Workspace composition

- Keep company, role, location/work pattern, available salary and status in the header. Preserve title/company editing. Put the real saved posting text link at the bottom of the header; do not invent missing values.
- Use the four visible tabs: **Overview, Documents, Role details, Activity**. Keep labels consistent across widths and preserve keyboard tab navigation.
- **Overview:** focus on evaluating the opportunity, accessible fit explanation, rationale/concerns, relevant notices and opening existing work. Routine generation belongs beside its document. Show Location, AI / Developer experience and Leadership as shadcn Card + ChartContainer radial gauges, using stored 0–100 ratings and 35% / 35% / 30% weights. Missing assessments are unassessed, not zero. Keep analytics in Activity.
- **Documents:** show document cards with live version, model and creation time. Place Open and generate actions beside their document. Expand saved versions inline using Collapsible, with separate authenticated Preview and Publish live actions. Expanded history survives publication refresh. Keep application questions and their editing, word limit/count, answer, copy, generation and deletion controls available here.
- **Role details:** use a readable main column, labelled description/context editors and distinct headings for private notes and AI instructions. Explain their actual input use; private notes may feed interview preparation. Keep primary editors discoverable rather than hiding them in a general-purpose accordion.
- **Activity:** show analytics first, then the newest-first audit log, then inline AI activity and usage for this job. Global usage remains aggregate. Analytics uses three columns even on mobile. Audit rows are one line, with exact local date/time first and action name second; long names may truncate visually while remaining fully accessible. Keep supporting detail in the row title, paginate older events and provide Refresh activity.
- Keep archive/restore/delete management distinct from generation history. Show only recorded or recoverable history; disclose gaps and unknown dates. Do not invent events or attribute unrelated historical usage to a job. Opening a print dialog is not proof that a PDF was saved.

## Reading, generation and versions

- Opening existing output, including stale output, must never start generation. Preview never publishes. Saving inputs, searching/filtering, opening a review, Cancel and Escape must also have no generation side effects.
- Retain explicit review and submission for all generation, including bulk and question answers. The reviewed operation, model, job set and any extra research must match what is dispatched. Changed inputs or broader scope require refreshed review, never silent expansion.
- Use allowed models and actual backend freshness/scope information. Do not invent cost estimates, progress, cancellation support or unavailable history. Historical cost is not a guaranteed future quote.
- Place an optional shadcn Textarea beneath the model selector for up to 4,000 characters of additional instructions. These supplement the job instructions for this request only. Model changes retain the draft; instruction changes require refreshed review. Keep the saved instructions accessible in authenticated version history, not public report bodies.
- Successful generation automatically makes the new version live. Keep the previous output readable while work runs and retain previous versions for preview and explicit publication. Preserve public/private boundaries and never describe this as draft-only generation.
- Distinguish missing, stale, running, failed and other backend-supported outcomes. Reload should recover running work; duplicate submission should recover the existing request rather than start another one.

## Editing, accessibility and responsive behaviour

- Use persistent field labels and local Saving, Saved and Couldn't save feedback. Retain drafts on failures, section/role changes and background updates. Preserve focus, cursor/selection and scroll; late saves must not overwrite newer edits or another job.
- Keep keyboard access, visible focus, semantic controls, accessible score explanations, dialog focus trapping, Escape/Cancel and focus return. Avoid hover-only explanations or essential actions. Announce meaningful save/run changes without announcing every poll or stealing focus.
- Verify contrast for text, controls and focus. Colour alone must not communicate stage, generation, errors or availability. Retain privacy labels and stale-output warnings.
- Collapse to one pane when the desktop columns no longer fit; use actual content fit around the existing 900 px breakpoint. Stack actions before labels become cramped and keep section navigation discoverable. Avoid horizontal action overflow.
- Provide at least 44 px mobile touch targets. Mobile review surfaces need a scrollable body and reachable actions; sticky controls must not cover content or keyboard focus.
- Preserve authentication, private document access, safe source links and escaped output. Use synthetic data in screenshots and fixtures; do not expose private content or tokens.

## Verification and maintenance

- For visual changes, inspect the affected screen in the browser at desktop and mobile widths; include 1280, 768, 390 and 360 px where relevant. Exercise realistic long names, missing fields, scrolling, empty/stale/running/failed states and keyboard interactions.
- Verify affected actions as well as appearance. Use mocked requests or deterministic fixtures to prove reading and cancelled reviews dispatch no generation; do not incur live AI costs merely to check UI wiring.
- Run the smallest relevant check under AGENTS.md. Browser/accessibility checks supplement visual and keyboard inspection; automated scans do not prove complete accessibility compliance. Full PR CI remains authoritative.
- Record unverified states and limitations. When a review changes a reusable rule, update this file in the same PR and explicitly replace the superseded guidance. Keep supporting SVG/PNG companions in sync if those guides are edited.
