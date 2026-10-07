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

The desktop shell fills the viewport width, with a 74px masthead and a 370px pipeline beside a flexible workspace. At 901–1100px the pipeline is 330px and workspace padding is 24px 20px. The desktop pipeline can collapse to a 64px rail with an always available secondary expand control; remember that choice across reloads. At 900px and below, use list/detail navigation and 17px shell side padding; the workspace has 22px top and 48px bottom padding.

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

- Desktop has an independently scrolling job list and reading pane. Its collapse control enlarges the reading pane without changing the selected job or filters. Mobile uses list/detail navigation, with Back to pipeline and browser Back restoring search, stage and list position.
- Keep full-width search and one compact stage dropdown in two sticky control rows. The dropdown includes the selected count; do not add wrapping stage chips, a duplicate matching-count line or an extra Filters button.
- Search and stage combine. Counts reflect the current active/archive collection and search before stage filtering, using the real data contract. Distinguish loading, empty pipeline, empty stage and no search matches.
- Bulk assessment uses the active roles currently displayed after search and stage filtering. Review that fixed set and write each role's private fit score and Overview summary. Wait for search results before offering the action. Fit page generation remains a separate per-role action.
- Job cards are fully selectable, with company/title hierarchy, a right-aligned score tile, named colour-coded stage metadata, document availability and relative added time with an exact-date title. Allow long company and role names to wrap. Keep generation toolbars and long rationales out of the list.
- Keep stage filtering separate from editing a job's status. Filtering never mutates a job; status editing never silently changes the filter. Use the application's stages and archive rules.
- Preserve selected job, collection, stage, search and section across navigation/reload. Use stable job IDs and prevent late responses from replacing the current selection. Keep private content and credentials out of URLs.
- If a status change or archive removes the selected job from the list, retain its workspace with an explanation and a return action. Do not unexpectedly select another job. Missing or inaccessible jobs need an honest empty state.

## Workspace composition

- Keep company, role, location/work pattern, available salary and status in the header. Preserve title/company editing. Put the real saved posting text link at the bottom of the header; do not invent missing values.
- Use the four visible tabs: **Overview, Documents, Role details, Activity**. Keep labels consistent across widths and preserve keyboard tab navigation.
- **Overview:** show the assessment date, five fit dimensions (Responsibilities 30%, Capability 30%, Scope 15%, Direction 5%, Compatibility 20%), model confidence and an Assess fit button. Highlight confidence below 70%, or unavailable confidence, beside its dimension with the warning colours and a visible Review rating cue. Confidence never reduces a fit score or implies that a specific fact is missing. Remove the separate information-sufficiency checks and generic dimension-gap warnings. Provisional status is reserved for incomplete, inaccessible, unrelated or uncertain postings: show the posting reason together in Fit assessment and a compact warning icon beside scores in the pipeline and role header with an accessible label. Omit provider names, tiers, unrelated posting-quality prose, repeated uncertainty explanations and historical score comparisons. Keep a brief outdated state and suppress confidence cues on outdated assessments. Follow with Summary: a short description of the position and a written interpretation of the saved scores. No Ready to use section, document shortcuts or analytics; document actions belong in Documents. Unassessed dimensions stay unassessed. Use one-word dimension labels in the UI; retain the full explanations in tooltips. Give each dimension a compact info icon beside its separate label, opening a shadcn Tooltip explanation on hover, keyboard focus or tap. Only the info icon triggers help. Keep the icon button a minimum 44px touch target, with Escape and outside dismissal; opening help must not move keyboard focus. Explain sustainable management duties, demonstrated capability, manageable accountability, support for future own businesses rather than promotions, and practical life fit respectively. Existing saved assessments retain their recorded weights until reassessment.
- **Documents:** show document cards with live version, model and creation time. Place Open and generate actions beside their document, with the action row order and styles defined above. The fit analysis and its tailored CV are one “Fit page & CV” document: one generate action writes both from the same instructions, they go live together on the role’s fit page, and they share one version history. Its actions are Open fit page, Open CV and Download CV, plus inline version history with authenticated Preview and explicit Publish live actions. Never show a review state the user cannot act on: a CV line that fails a factual or layout check is replaced automatically with approved evidence wording, and a failed attempt says to generate again. If a valid saved CV has not been published, label it “Saved · not live” and provide authenticated preview/download actions for that version; do not expose a public fit link. When neither a valid saved CV nor a live tailored CV exists, show “Download general CV” only when the backend confirms the general CV is published. Keep this visibly separate from job-specific generation; it is a general document, never described as tailored to the role. Keep the previous CV readable while another version runs. On Applied roles, show a submitted-version record only when the backend supplies one; do not imply that changing the stage submits a document. Keep cover-letter generation an explicit manual action. Do not offer a combined CV and letter document. Keep application questions and their editing, word limit/count, answer, copy, generation and deletion controls available here.
- **Role details:** use a readable main column, labelled description/context editors and distinct headings for private notes and AI instructions. Explain their actual input use; private notes may feed interview preparation. Keep primary editors discoverable rather than hiding them in a general-purpose accordion.
- **Activity:** show analytics first, then the newest-first audit log, then inline AI activity and usage for this job. Global usage remains aggregate. Analytics uses three columns even on mobile. Audit rows are one line, with exact local date/time first and action name second; long names may truncate visually while remaining fully accessible. Keep supporting detail in the row title, paginate older events and provide Refresh activity.
- Keep archive/restore/delete management distinct from generation history. Show only recorded or recoverable history and label unknown dates accurately, without migration-era disclaimers. Do not invent events or attribute unrelated historical usage to a job. Opening a print dialog is not proof that a PDF was saved.

## Reading, generation and versions

- The latest saved five-dimension fit assessment supplies visible scores, including when later input changes make it outdated. Label outdated scores and offer reassessment; keep outdated Overview prose hidden. Do not show historical report scores in document versions or use them as a fallback in the pipeline or role header. Generating or publishing a document does not rescore the role.
- Fit freshness depends on the role inputs, candidate scoring evidence, scoring rubric, weights, model and scoring policy. Interview notes, writing prompts and deletion of historical score fields do not make a fit assessment outdated. Preserve saved assessment provenance when recognizing compatible migrated fingerprints.
- Introduce generation reviews with one short, natural explanation of what the user will receive. Omit headings such as Work to run and procedural task lists. Mention meaningful scope, such as refreshing company research before writing a brief, in plain language.
- Assess fit also writes the private Overview summary using Sol behind the scenes. Save it with the exact assessment/input snapshot; hide outdated prose after context changes. Loading Overview never generates. Existing assessments acquire summaries on explicit reassessment. Keep summaries concise, grounded in the description and scores, and reflect material uncertainty without boilerplate.
- Refresh the selected role's detail when a fit assessment completes so its private Overview summary appears alongside the updated scores without a page reload.


- Opening existing output, including stale output, must never start generation. Preview never publishes. Saving inputs (except the explicit move to Reviewing described below), searching/filtering, opening a review, Cancel and Escape must also have no generation side effects.
- Moving a job to Reviewing automatically creates a missing fit page and customised CV, in that order. Existing results are preserved. Cover letters are generated only through their explicit manual action. Other generation, including CV regeneration, bulk work and question answers, retains explicit review and submission. The reviewed operation, model, job set and any extra research must match what is dispatched. Changed inputs or broader scope require refreshed review, never silent expansion.
- Use allowed models and actual backend freshness/scope information. Do not invent cost estimates, progress, cancellation support or unavailable history. Historical cost is not a guaranteed future quote.
- Place an optional shadcn Textarea beneath the model selector for up to 4,000 characters of additional instructions. These supplement the job instructions for this request only. Model changes retain the draft; instruction changes require refreshed review. Keep the saved instructions accessible in authenticated version history, not public report bodies.
- Successful generation automatically makes the new version live. Keep the previous output readable while work runs and retain previous versions for preview and explicit publication. Preserve public/private boundaries and never describe this as draft-only generation.
- Distinguish missing, stale, running, failed and other backend-supported outcomes. Reload should recover running work; duplicate submission should recover the existing request rather than start another one.

## Admin chat

- Chat is private to the authenticated admin and reads Sanity content. Suggested answers do not save or publish changes.
- Open Ask your assistant from the top-right masthead button on desktop and a fixed bottom-right button on phone widths. Place mobile task notifications above the floating button so both remain reachable. Use a nonmodal right side panel that remains open while browsing the admin. At wide desktop widths, reserve space for the panel; at narrower widths, overlay the right side while leaving the rest of the app interactive. On phones, use a full-height surface and close it when following an in-app source link. Keep the composer beneath independently scrolling messages. Give New chat a distinct control with clear space from Close, placing it below the title and description on mobile. Closing preserves the conversation and draft; session expiry clears both. Keep the current conversation, request ID, run ID and stream cursor in sessionStorage so a reload reconnects to the same work. New chat clears the visible conversation while retaining an unsent draft.
- Use the actual shadcn Message Scroller with Message/Bubble and the existing form primitives. Enable automatic scrolling to follow streaming responses at the bottom. Preserve scroll position while reading older messages; the scroll-to-end action resumes following new text.
- Jev selects the model and provider automatically for every question. Keep routing behind the scenes: no provider/model controls or model badges in chat. If routing is unavailable, offer retry rather than manual model selection. Render assistant replies as Markdown with headings, lists, tables and code; disable raw HTML and unsafe links, and keep wide content scrollable inside the answer.
- Keep streamed text, a single Sources consulted panel below every answer, draft input and partial failed/stopped answers readable. Show an honest empty state when no source records are available. Source rows show readable titles without Sanity IDs; link to the relevant in-app role section when a validated job ID is available. Do not repeat sources in the answer body. Stop and explicit Retry must describe the real request lifecycle. Send is the explicit submission for a chat turn; it does not require a document-generation review dialog.
- Keep assistant behavior instructions in the published Sanity Chat settings document. The agent composes the stored assistant and context prompts with the current context response; it must not append product-specific prompt text in code. Seed defaults describe new installations only and never overwrite published edits.
- Keep the composer reachable on mobile, controls labelled, keyboard focus stable and status announcements polite. Do not show raw tool payloads or hidden reasoning.
- Use the footer beneath the composer for live request status: queued, connecting, thinking, reading, writing, saving, reconnecting and terminal outcomes. Remove the standing Insights storage notice; private transcript saving remains enabled. Show source links only from validated source metadata; render model text safely. Incomplete answers require explicit Retry or New chat before another turn, so partial text is not silently reused as completed evidence.
- Follow [the implementation plan](docs/admin-chat-implementation-plan.md) for transport, source links and rollout verification.

## Background task notifications

- Chat uses its inline composer status instead of a duplicate task toast. Every other app action dispatched to Trigger shows one persistent toast keyed by its run ID (not its action button), updated from Trigger Realtime status and phase metadata through completion, failure, cancellation or expiry. Use human-readable task names and role context; keep relevant role, pipeline and result links in the toast.
- On reload, check saved run status before restoring notifications. Restore toasts for unfinished work only; results that finished before the reload belong in the role, not in a newly opened toast.
- Lock the corresponding action from submission until a confirmed terminal result, including after navigation, re-render and recovery on reload. Keep unrelated controls usable. A lost status connection means reconnecting, not task failure; keep the action locked while reconnecting.
- Use Sonner for task notifications. Every notification can be dismissed manually, including running work; dismissal hides the notification without cancelling its task, releasing its action lock or reopening it on later updates or reload. Toasts never steal focus. Keep status announcements polite. Successful notifications show a visible Dismiss countdown from five seconds and automatically disappear at that deadline, even if the toast receives another update. Keep failed notifications visible until dismissed. Links and dismiss controls must be keyboard-accessible with 44px mobile targets. Keep the stack scrollable within narrow screens. Do not repeat background task phases or outcomes in the role-wide status line, document actions, or overview summary; keep inline feedback for direct edits.

## Editing, accessibility and responsive behaviour

- Use persistent field labels and local Saving, Saved and Couldn't save feedback. Retain drafts on failures, section/role changes and background updates. Preserve focus, cursor/selection and scroll; late saves must not overwrite newer edits or another job.
- Keep keyboard access, visible focus, semantic controls, accessible score explanations, dialog focus trapping, Escape/Cancel and focus return. Avoid hover-only explanations or essential actions. Announce meaningful save/run changes without announcing every poll or stealing focus.
- Verify contrast for text, controls and focus. Colour alone must not communicate stage, generation, errors or availability. Retain useful privacy labels and concise stale-output states; avoid repeating generic explanations.
- Collapse to one pane when the desktop columns no longer fit; use actual content fit around the existing 900 px breakpoint. Stack actions before labels become cramped and keep section navigation discoverable. Avoid horizontal action overflow.
- Provide at least 44 px mobile touch targets. Mobile review surfaces need a scrollable body and reachable actions; sticky controls must not cover content or keyboard focus.
- Preserve authentication, private document access, safe source links and escaped output. Use synthetic data in screenshots and fixtures; do not expose private content or tokens.

## Verification and maintenance

### Public application documents

- The CV has two published layouts, chosen by the Sanity CV settings: the one-page `classic` layout and the two-page `detailed` layout (decided 2026-10-07). The classic CV is a single A4 page; prioritise recent management responsibilities and delivered work and shorten older experience before reducing the body below 13px. CV content and downloadable PDF must be reviewed together.
- The two-page CV runs, in order: header, Profile (approved paragraphs), Core skills (one paragraph per group with a bold run-in label and plain comma-separated items, no brackets), Experience, Featured project, Side projects and community (an intro line, then one paragraph per entry with a bold run-in title followed by its links) and Education (title, dates and place only). Earlier-career roles (Critical Software) close Experience as a one-line entry; there is no separate Earlier career section. Full experience entries show a scope line, then the fixed Stack line, then responsibilities and two or three highlights; the Stack line separates the description from the items. A short entry (Connect Coimbra) shows scope and responsibilities only. There is no Domains line. Every responsibility and highlight keeps the light grey 2px left border (never the accent colour), with a slightly larger gap before the first highlight; neither gets a sub-heading. The Stack line uses a small accent Plex Mono label and items joined with “·”. Bold (weight 600, ink colour) marks only phrases that show skills and capabilities, written in Sanity as **double asterisks**, in the profile, scope lines, responsibilities, highlights and featured project; do not bold product names, acronyms or compliance terms. Jobs sit further apart than other entries (22px in the PDF, 40px on the fit page) so each role reads as one group. In the PDF and the wide reader, entries use the full text width with dates and place on the title line, right-aligned and joined with “·”; on mobile the meta line moves under the title as in the one-page CV. Body text stays at 13px with 1.32 line height, 5.5mm between sections and A4 print margins of 10mm top, 13mm sides and 9mm bottom. Page 1 holds the profile, core skills and the two most recent roles; a role marked “Start a new PDF page” in Sanity (EDITED) always opens page 2. Entries may otherwise break across pages, but titles never end a page. All text is approved Sanity copy shown verbatim: when the CV runs past its page limit, drop highlights (from the role with the most, oldest first, at least one per role) rather than shrinking type or spacing. On the fit page (and shared report page) the two-page CV opens on a short summary (decided 2026-10-07): the first profile paragraph, “Highlights for this role” (just “Highlights” on shared reports) with the first, most relevant chosen achievement from each full role plus the featured project's first scope sentence, each as a grey-bordered paragraph with its company in small accent Plex Mono beneath, then a “Career” timeline of one line per role (dates, title, “· Company”). The complete CV (remaining profile, core skills, full experience, featured project, side projects and community, education, with the same sections, order, bold and borders as the PDF) sits in a native `<details>` behind an outlined pill “Show full CV” / “Hide full CV” control (full width on mobile, keyboard focusable). The Download CV · PDF action stays at the top. No horizontal rule separates the summary from the full CV.
- The standalone public /cv reader presents the approved general CV, not a role-specific fit document. Keep its “Download CV · PDF” action pointed at the canonical /bernardo-raposo-cv.pdf route and its closing link pointed at the public site; do not use job-fit claims, fit-analysis copy or private evidence metadata there. The PDF and reader must contain the same ordered public CV content and remain readable at phone widths.
- Keep the CV header to the name, professional headline, home location and contact links. Omit UK Settled Status, sponsorship, availability and London travel lines; leave the freed space empty. These facts remain in private candidate context for relevant application questions.
- Shared fit report links (`/?r=<reportId>`) use the fit page design. When the report's job has a live application page, the link redirects to `/fit/:publicId`; otherwise the server renders the report in the same template with the published general CV, labelled “CV” rather than “Application CV”, downloads `/bernardo-raposo-cv.pdf` and keeps view and download tracking. If the report or general CV cannot be loaded, the legacy client-rendered report remains the fallback. The new personalised `/fit/:publicId` application page flows from the fit introduction and pitch through its supplied categories and “What I bring” differentiators to the Application CV. Keep a single “Download CV · PDF” action beside the Application CV on that page; omit a duplicate report-level download action. Neither the personalised nor the shared fit page shows an eyebrow label above the role title or report closing text between “What I bring” and the CV. Render only evidence sections the report contains; an empty differentiators array does not create an empty heading. Preserve legacy report content and link tracking. On the personalised page, use whitespace and typographic hierarchy instead of repeated horizontal rules; separate each role, project and speaking entry with spacing. Keep experience evidence as distinct paragraphs without visible bullet markers. Preserve available public contact links, including phone when supplied, with their normal link affordances and no inserted separator dots.
- The fit report presents three categories under “Where I land” and three differentiators under “What sets me apart” for the current prompt. Keep the experience numbers, beside the text on desktop and above it on mobile. Both sections share title typography (16–21px, weight 600, line-height 1.3) and body typography (16px, line-height 1.65, body2 colour). Render all supplied entries so older reports keep their content.
- The master CV and standalone cover letter use the public identity from the Sanity CV document. A role-specific customised CV is private and available only through authenticated admin actions until explicitly published. Candidate profile details are private and must never be projected wholesale into a public page.
- Application CVs include every major career role and select the strongest truthful evidence for the target job description within each role; relevance guides emphasis, not which major roles disappear. Use “Other contributions” for compact independent-work, open-source and speaking entries. Group related open-source packages into one supported overview with labelled, approved project links; keep speaking distinct. Within career entries, retain supported business, leadership and organisational experience alongside technical delivery. Describe company growth and platform scale as context unless the evidence explicitly credits a candidate outcome. Apply the same clean hierarchy to the downloadable PDF: no horizontal divider rules or bullet markers; each evidence paragraph is indented with a light 2px left border that works as the list marker (also on the fit page CV), small paragraph gaps, larger entry gaps and the largest gaps between sections. Preserve readable type and A4 overflow checks instead of shrinking the text to compensate for spacing.
- Public documents share one accent (`oklch(0.52 0.14 250)`, `#1f6fb2` in the bundled-font PDF) and the brand mark: the candidate name is followed by an accent full stop on the fit page CV, application/general CV and cover letter. On the personalised fit page, “What I bring” differentiators sit in white cards on the warm paper background (one column on mobile), and the Application CV sits on its own white sheet so the downloadable document reads as distinct from the pitch. Its roles use a left meta column for dates and location beside the title, “· company” and evidence; on mobile the meta line moves under the title. The Download CV · PDF action is a filled ink pill. The A4 CV and standalone general/application CV readers use a fully white page and white screen background, without section boxes, corner rounding or sheet shadows. Keep the layout balanced with one shared left edge: the header, section labels, entries and footer all align to the page padding (11mm top, 13mm sides, 8mm bottom on A4; 20px sides in the mobile reader), with no extra inset on the header or sections. Space sections evenly with a 6mm top margin (32px in the mobile reader), entries 11px apart (22px on mobile), and 6px between successive job evidence paragraphs (4px elsewhere). Like the fit page CV, and in the same proportions to the 13px body (15px titles, 10px Plex Mono dates, 11px location and links), each entry has a 31mm left meta column with dates on one line and the location below in small grey text, beside the title, “· Company” and evidence; on mobile the meta line moves under the title. A location written as “Place | Kind of business” shows each part on its own line (joined with “·” on mobile), on the fit page too. Entries without dates or location keep the empty column so titles stay aligned. Contribution links sit below their evidence, left-aligned, on screen and in the PDF. Keep the footer at the foot of the sheet. Use spacing alone between Experience, Education and Other contributions; keep all horizontal separators absent, including around the header and footer. Do not add a coloured side border to the header. Section labels are plain accent IBM Plex Mono capitals with no leading marker; entry headings set “Title” in Schibsted with “· Company” in the accent; the fit/public link sits on the paper at the foot of the page. The renderer embeds Plex Sans 400/600, Schibsted Grotesk 600/700 and Plex Mono 500 from `lib/assets/cv-fonts`. Do not use positioned elements in the PDF header: they change the PDF text order that validation checks. On the fit page CV, company names also use the accent and dates use Plex Mono. The cover letter uses wider A4 margins and 13.5px body text with spacing (not a divider rule) between header and letter; a maximum-length letter must still fit one page.
- Document readers reflow at mobile widths while print retains A4 geometry. Letters may contain older, longer content; overflow warnings must remain visible and old saved paragraphs must not be silently cut to satisfy new generation budgets.

- For visual changes, inspect the affected screen in the browser at desktop and mobile widths; include 1280, 768, 390 and 360 px where relevant. Exercise realistic long names, missing fields, scrolling, empty/stale/running/failed states and keyboard interactions.
- Verify affected actions as well as appearance. Use mocked requests or deterministic fixtures to prove reading and cancelled reviews dispatch no generation; do not incur live AI costs merely to check UI wiring.
- Run the smallest relevant check under AGENTS.md. Browser/accessibility checks supplement visual and keyboard inspection; automated scans do not prove complete accessibility compliance. Full PR CI remains authoritative.
- Record unverified states and limitations. When a review changes a reusable rule, update this file in the same PR and explicitly replace the superseded guidance. Keep supporting SVG/PNG companions in sync if those guides are edited.
- Include labelled before-and-after screenshots in every visual PR description, at desktop and mobile widths. Compare the base and changed revisions using identical synthetic content, viewport, UI state, scroll position and fonts; disable animations and wait for rendering to settle. Inspect the captures, embed durable reviewer-accessible image links, and record revision IDs, viewport sizes and any limitations. Screenshots saved only on the author's machine do not satisfy this requirement; use `docs/pr-screenshots/<change>/` when an upload is unavailable. Explain any blocked or missing comparison in the PR.

- In the CV’s Other contributions, show Fit and Hermans Club as separate linked entries, with Hermans Club immediately after Fit, followed by Open source and Speaking. Keep a direct project link for each independent project, retain all approved repository links, and label each speaking link with its event and verified year. Presentation URLs and dates are editorial source data in Sanity. Use concise, source-backed project descriptions to preserve one A4 page at the existing font size and spacing.
