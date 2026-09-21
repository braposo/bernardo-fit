---
version: "alpha"
name: "Bernardo Fit Admin"
description: "Current AdminCN-inspired light admin workspace; extracted from the existing CSS cascade."
colors:
  primary: "#6055a6"
  background: "#f6f7f9"
  foreground: "#252631"
  card: "#ffffff"
  secondary: "#efedf5"
  muted-foreground: "#666d7b"
  border: "#e0e3eb"
  input: "#c8ccd7"
  destructive: "#a02929"
  on-destructive: "#ffffff"
  pipeline: "#f8f9fc"
  selected-background: "#f8f7ff"
  selected-border: "#9487ce"
  selected-indicator: "#8576c2"
  action-background: "#eeedf4"
  action-text: "#514d65"
  action-border: "#dddbe7"
  generation-hover: "#e4e1ed"
  score-background: "#f3f1f9"
  score-text: "#514779"
  score-border: "#e3dff1"
  warning-background: "#fff0d4"
  warning-text: "#7a4810"
  warning-border: "#dfc18c"
  stage-interviewing-background: "#efebff"
  stage-interviewing-text: "#6b45ac"
  stage-applied-background: "#e9f0ff"
  stage-applied-text: "#3265b6"
  stage-reviewing-background: "#e6f3f3"
  stage-reviewing-text: "#267773"
  stage-offer-background: "#e5f4e9"
  stage-offer-text: "#367b4c"
  stage-rejected-background: "#fcebec"
  stage-rejected-text: "#ae4554"
  stage-neutral-background: "#eceef2"
  stage-neutral-text: "#626a7b"
typography:
  role-heading:
    fontFamily: "IBM Plex Sans"
    fontSize: "24px"
  role-heading-mobile:
    fontFamily: "IBM Plex Sans"
    fontSize: "20px"
  section-heading:
    fontFamily: "IBM Plex Sans"
    fontSize: "18px"
  dialog-heading:
    fontFamily: "IBM Plex Sans"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
  body-rationale:
    fontFamily: "IBM Plex Sans"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.7
  company:
    fontFamily: "IBM Plex Sans"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  role-list:
    fontFamily: "IBM Plex Sans"
    fontSize: "13px"
    lineHeight: 1.5
  metadata:
    fontFamily: "IBM Plex Sans"
    fontSize: "12px"
  timestamp:
    fontFamily: "IBM Plex Sans"
    fontSize: "11px"
  button:
    fontFamily: "IBM Plex Sans"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
  document-action:
    fontFamily: "IBM Plex Sans"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  score:
    fontFamily: "IBM Plex Sans"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-1px"
rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  pipeline-card: "13px"
  score-tile: "11px"
  version-card: "9px"
  document-open: "6px"
  model-label: "4px"
spacing:
  action-gap: "8px"
  pipeline-gap: "12px"
  document-gap: "14px"
  pipeline-card-padding: "16px"
  document-card-padding: "20px"
  role-card-padding: "24px"
  workspace-top: "28px"
  workspace-inline: "32px"
  workspace-bottom: "48px"
  mobile-shell-inline: "17px"
  mobile-workspace-top: "22px"
components:
  button-primary:
    backgroundColor: "{colors.action-background}"
    textColor: "{colors.action-text}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
  button-generation:
    backgroundColor: "{colors.action-background}"
    textColor: "{colors.action-text}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
  button-regeneration:
    backgroundColor: "{colors.card}"
    borderColor: "{colors.action-border}"
    textColor: "{colors.action-text}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
  button-generation-hover:
    backgroundColor: "{colors.generation-hover}"
    textColor: "{colors.action-text}"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.on-destructive}"
    rounded: "{rounded.md}"
  document-open:
    backgroundColor: "{colors.action-background}"
    textColor: "{colors.action-text}"
    typography: "{typography.document-action}"
    rounded: "{rounded.document-open}"
  pipeline-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.pipeline-card}"
    padding: "{spacing.pipeline-card-padding}"
  pipeline-card-selected:
    backgroundColor: "{colors.selected-background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.pipeline-card}"
  document-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "{spacing.document-card-padding}"
  role-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "{spacing.role-card-padding}"
  score-tile:
    backgroundColor: "{colors.score-background}"
    textColor: "{colors.score-text}"
    typography: "{typography.score}"
    rounded: "{rounded.score-tile}"
    width: "58px"
    height: "68px"
  assessment-warning:
    backgroundColor: "{colors.warning-background}"
    textColor: "{colors.warning-text}"
    rounded: "{rounded.lg}"
    padding: "12px"
  stage-interviewing:
    backgroundColor: "{colors.stage-interviewing-background}"
    textColor: "{colors.stage-interviewing-text}"
  stage-applied:
    backgroundColor: "{colors.stage-applied-background}"
    textColor: "{colors.stage-applied-text}"
  stage-reviewing:
    backgroundColor: "{colors.stage-reviewing-background}"
    textColor: "{colors.stage-reviewing-text}"
  stage-offer:
    backgroundColor: "{colors.stage-offer-background}"
    textColor: "{colors.stage-offer-text}"
  stage-rejected:
    backgroundColor: "{colors.stage-rejected-background}"
    textColor: "{colors.stage-rejected-text}"
  stage-neutral:
    backgroundColor: "{colors.stage-neutral-background}"
    textColor: "{colors.stage-neutral-text}"
---

# Bernardo Fit admin design

## Overview

A calm, compact job-management workspace with grey-white surfaces, restrained purple accents, separated cards and clear metric hierarchy. Keep reading, editing and AI generation easy to distinguish. The detailed guidance applies to the admin; public fit pages and document readers retain their own design unless explicitly in scope.

This file follows the [Google Labs DESIGN.md format](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md), with project-specific interaction sections after the standard visual sections. [Decision history and original sources](docs/design-decisions.md) record superseded proposals; the latest explicit user decision takes precedence.

The YAML is the documented visual baseline, extracted from [admin CSS](src/admin/styles.css), [the HTML shell](public/admin.html) and [shadcn component sources](src/admin/components/ui). These descriptive token names are not all existing CSS variables. This is a source-based extraction, not a new theme or a claim that every screen complies. The application still consumes CSS, not this file; update documentation and implementation together when changing a token. Do not generate or replace the stylesheet from this partial inventory.

## Colors

Use primary purple for links, active navigation and focus; background/card/pipeline tokens define the layered neutral surfaces. Default, secondary and first-generation buttons share action-background/action-text, with action-border. Regenerating an existing document uses the outline button with a card background and action-border/action-text. Primary here names the accent, not a requirement to fill primary buttons purple.

Selected job cards use selected-background, selected-border and an inset selected-indicator. Stages pair named labels with their own surface/text colours; new, expired and not_interested use the neutral stage pair. Assessment uncertainty uses warning colours. Amber is not the current generation-button treatment. Destructive actions retain their separate red treatment.

The later approved-theme declarations and component overrides win over the initial warm palette in styles.css. In particular, the old generation theme variables still exist but do not describe the visible generation buttons. Border-only and semantic tokens remain useful even when not referenced by a YAML component entry.

## Typography

Use IBM Plex Sans for the current admin display and body roles. The existing font assets also include IBM Plex Mono for remaining technical shell text; loading Schibsted Grotesk does not make it the current admin heading font. Preserve existing font assets.

Typography entries name concrete roles rather than imposing a new global scale. Properties omitted from an entry continue to inherit from the relevant component/shell. Role headings reduce from 24px to 20px on mobile; document actions use 12px rather than the base 14px button text. Timestamp text is currently 11px, reducing to 10px in narrow audit rows. These small sizes describe the baseline and remain review candidates, not accessibility endorsements.

## Layout

The desktop shell fills the viewport width, with a 74px masthead and a 370px pipeline beside a flexible workspace. At 901–1100px the pipeline is 330px and workspace padding is 24px 20px. At 900px and below, use list/detail navigation and 17px shell side padding; the workspace has 22px top and 48px bottom padding.

Document cards form two columns on wide desktop and one at 1100px and below. Desktop workspace padding is 28px 32px 48px. Spacing tokens capture actual recurring gaps and padding, not an invented uniform spacing scale. Preserve component-specific values where they differ.

Keep at least 44px mobile touch targets as the design goal. Base controls use a 44px minimum height; some existing exceptions (the 40px-wide status editor and 30px-high posting link) still require review rather than being presented as compliant. Preserve independently scrolling desktop panes and sticky search/filter controls.

## Elevation & Depth

Use surface contrast and 1px borders for most hierarchy. Job cards have a subtle 0 2px 3px #25263108 shadow; selected cards replace it with an inset 3px left indicator. Role/document cards and muted action buttons explicitly have no shadow. Preserve the existing dialog/popover component elevation rather than applying card shadows globally.

## Shapes

The shared radius is 0.75rem. At the default 16px root size, the existing Tailwind radius mapping resolves sm/md/lg/xl to 8/10/12/16px. Card primitives use xl; dialogs use the base 12px radius. Job cards override this to 13px, score tiles to 11px, version cards to 9px and document Open actions to 6px. The YAML preserves these differences. Navigation controls remain square with an active underline.

## Components

- Put alert text and inline actions inside AlertDescription so they share the content column. Bare text must not occupy the Alert icon column; notices should wrap naturally at narrow widths.
- Use the actual shadcn components under [src/admin/components/ui](src/admin/components/ui), not raw HTML decorated to resemble them. Keep the existing Radix implementation; the free AdminCN template provides composition inspiration, not a Base UI migration.
- Use Button for actions; labelled Input/Textarea and NativeSelect for forms; Tabs for workspace sections; Dialog for generation review; AlertDialog for destructive confirmation; Card and Collapsible for documents and history; Popover plus NativeSelect for the icon-only status editor; Table for usage.
- Use explicit action verbs: Open letter, Rewrite letter, Refresh research, Copy link, Publish live. A document name alone is not an action label. Reading, editing, generation and permanent deletion must remain distinguishable without relying on colour.
- Generation controls use Lucide Sparkles as the visual convention for AI work. Omit visible cost legends, repeated Paid AI labels and generic explanations. Keep a concise accessible description for assistive technology. Use task verbs without model/provider names; automatic routing belongs behind the scenes.
- Keep button labels on one line unless the available space genuinely requires wrapping. In document cards, put existing document Open actions together in the first row. When a saved document has other actions, put its Generate new version action on a separate full-width row and use the outline variant; retain Sparkles so the action still reads as generation. First-generation actions keep their filled style.

## Do's and Don'ts

- Describe the current experience. Keep migration notes, previous implementation details and explanations of when tracking began out of product copy. Preserve useful current-state labels such as estimated costs, stale content and unsaved edits; keep implementation history in documentation.
- Reuse the current tokens and Radix-based shadcn components; preserve descriptive labels, keyboard access and visible focus.
- Keep Open and generation as separate actions. Keep Sparkles as the AI indicator without visible explanatory boilerplate.
- Preserve drafts, current selection and previous outputs during background work.
- Do not restore superseded amber generation styling, old section names or version-history placement from earlier wireframes.
- Do not turn sample data, mockup annotations or missing backend capabilities into product content.

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
- **Overview:** show the assessment date, five fit dimensions (Responsibilities fit 25%, Evidence of capability 25%, Seniority and scope 20%, Career direction 20%, Practical compatibility 10%), model confidence and an Assess fit button. Omit provider names, tiers, posting-quality prose, repeated uncertainty explanations and historical score comparisons. Keep a brief outdated state and existing header status badges for actionable issues. Follow with Summary: a short description of the position and a written interpretation of the saved scores. No Ready to use section, document shortcuts or analytics; document actions belong in Documents. Unassessed dimensions stay unassessed.
- **Documents:** show document cards with live version, model and creation time. Place Open and generate actions beside their document, with the action row order and styles defined above. Expand saved versions inline using Collapsible, with separate authenticated Preview and Publish live actions. Expanded history survives publication refresh. Keep application questions and their editing, word limit/count, answer, copy, generation and deletion controls available here.
- **Role details:** use a readable main column, labelled description/context editors and distinct headings for private notes and AI instructions. Explain their actual input use; private notes may feed interview preparation. Keep primary editors discoverable rather than hiding them in a general-purpose accordion.
- **Activity:** show analytics first, then the newest-first audit log, then inline AI activity and usage for this job. Global usage remains aggregate. Analytics uses three columns even on mobile. Audit rows are one line, with exact local date/time first and action name second; long names may truncate visually while remaining fully accessible. Keep supporting detail in the row title, paginate older events and provide Refresh activity.
- Keep archive/restore/delete management distinct from generation history. Show only recorded or recoverable history and label unknown dates accurately, without migration-era disclaimers. Do not invent events or attribute unrelated historical usage to a job. Opening a print dialog is not proof that a PDF was saved.

## Reading, generation and versions

- Only the current five-dimension fit assessment supplies visible scores. Do not show historical report scores in document versions or use them as a fallback in the pipeline or role header. Generating or publishing a document does not rescore the role.
- Introduce generation reviews with one short, natural explanation of what the user will receive. Omit headings such as Work to run and procedural task lists. Mention meaningful scope, such as refreshing company research before writing a brief, in plain language.
- Assess fit also writes the private Overview summary using Sol behind the scenes. Save it with the exact assessment/input snapshot; hide outdated prose after context changes. Loading Overview never generates. Existing assessments acquire summaries on explicit reassessment. Keep summaries concise, grounded in the description and scores, and reflect material uncertainty without boilerplate.


- Opening existing output, including stale output, must never start generation. Preview never publishes. Saving inputs, searching/filtering, opening a review, Cancel and Escape must also have no generation side effects.
- Retain explicit review and submission for all generation, including bulk and question answers. The reviewed operation, model, job set and any extra research must match what is dispatched. Changed inputs or broader scope require refreshed review, never silent expansion.
- Use allowed models and actual backend freshness/scope information. Do not invent cost estimates, progress, cancellation support or unavailable history. Historical cost is not a guaranteed future quote.
- Place an optional shadcn Textarea beneath the model selector for up to 4,000 characters of additional instructions. These supplement the job instructions for this request only. Model changes retain the draft; instruction changes require refreshed review. Keep the saved instructions accessible in authenticated version history, not public report bodies.
- Successful generation automatically makes the new version live. Keep the previous output readable while work runs and retain previous versions for preview and explicit publication. Preserve public/private boundaries and never describe this as draft-only generation.
- Distinguish missing, stale, running, failed and other backend-supported outcomes. Reload should recover running work; duplicate submission should recover the existing request rather than start another one.

## Editing, accessibility and responsive behaviour

- Use persistent field labels and local Saving, Saved and Couldn't save feedback. Retain drafts on failures, section/role changes and background updates. Preserve focus, cursor/selection and scroll; late saves must not overwrite newer edits or another job.
- Keep keyboard access, visible focus, semantic controls, accessible score explanations, dialog focus trapping, Escape/Cancel and focus return. Avoid hover-only explanations or essential actions. Announce meaningful save/run changes without announcing every poll or stealing focus.
- Verify contrast for text, controls and focus. Colour alone must not communicate stage, generation, errors or availability. Retain useful privacy labels and concise stale-output states; avoid repeating generic explanations.
- Collapse to one pane when the desktop columns no longer fit; use actual content fit around the existing 900 px breakpoint. Stack actions before labels become cramped and keep section navigation discoverable. Avoid horizontal action overflow.
- Provide at least 44 px mobile touch targets. Mobile review surfaces need a scrollable body and reachable actions; sticky controls must not cover content or keyboard focus.
- Preserve authentication, private document access, safe source links and escaped output. Use synthetic data in screenshots and fixtures; do not expose private content or tokens.

## Verification and maintenance

- For visual changes, inspect the affected screen in the browser at desktop and mobile widths; include 1280, 768, 390 and 360 px where relevant. Exercise realistic long names, missing fields, scrolling, empty/stale/running/failed states and keyboard interactions.
- Verify affected actions as well as appearance. Use mocked requests or deterministic fixtures to prove reading and cancelled reviews dispatch no generation; do not incur live AI costs merely to check UI wiring.
- Run the smallest relevant check under AGENTS.md. Browser/accessibility checks supplement visual and keyboard inspection; automated scans do not prove complete accessibility compliance. Full PR CI remains authoritative.
- Record unverified states and limitations. When a review changes a reusable rule, update this file in the same PR and explicitly replace the superseded guidance. Keep supporting SVG/PNG companions in sync if those guides are edited.
