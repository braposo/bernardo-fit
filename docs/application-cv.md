# Application CVs

Moving a role to **Reviewing** creates its missing fit analysis, then queues `application-cv` in Trigger.dev. Cover letters now require the existing manual generation action. Opening a role, deploying the app, or editing its notes does not backfill documents or spend tokens.

The task uses the saved job description and published, approved Sanity career evidence. It rewrites experience within the original employer and preserves the approved profile headline, role titles, dates and chronology. Each role has an editor-selected, approved overview fact from the existing career source. The writer may rewrite and reorder that overview, but must retain its broad responsibilities and work areas even when it emphasizes different highlights for a particular job. Each experience bullet retains private evidence references. Proposed work is excluded from delivered achievements. Source facts distinguish personal implementation, team delivery and strategy. A separate generated profile summary is deliberately omitted: live verification found that this abstraction added unsupported claims without improving the tailored employment evidence.

## Generation and publication

1. Snapshot the job, fit analysis, source revisions, model and version instructions. Allocate a stable job-specific public ID.
2. Run one low-effort writer call through `durable-model-call` to tailor employment bullets. Validate role identity, chronology, evidence references, presence of each role's approved overview, unsupported numbers and contribution scope.
3. Run a separately checkpointed factual verifier for rewritten content. It must affirm meaningful overview coverage for every role as well as factual entailment; citing an overview ID without retaining its breadth is insufficient. An unsupported or narrowed claim stops publication; there is no automatic paid rewrite loop. The private version records the verifier's per-role coverage decision.
4. Render a single A4 PDF using the existing Playwright renderer and bundled, licensed fonts. Check readable body size, overflow, page count, selectable text order, and the exact fit-page hyperlink.
5. Save an immutable Sanity version and PDF asset, with its checksum, private source mapping, validation, verification, usage, and template/renderer versions. Publish the fit snapshot and CV together by changing one binding reference.

The public page is `/fit/:publicId`; its **Download CV** action uses `/fit/:publicId/cv.pdf`. Downloads serve the saved PDF bytes and do not invoke a model or browser renderer. Public output is an allowlist and excludes evidence IDs, instructions, source snapshots, validation diagnostics and costs. Deleted jobs no longer resolve; archiving preserves existing links. Personal application pages and PDFs are marked `noindex`.

The public page and PDF use spacing and type hierarchy to separate sections and entries, without repeated horizontal rules or visible bullet markers. Existing evidence units remain independently cited in storage and render as paragraphs; changing their presentation does not require another model call. Renderer `a4-one-column-3` also verifies extracted contact labels and clickable phone links. Existing saved PDF assets retain their original presentation until a new version is generated.

A failed generation leaves the previous public pair available. A `needs_review` result is a private draft with visible issues and an explicit retry action. Marking an application **Applied** pins the current version. Subsequent generation saves a candidate without replacing that publication. Explicitly publishing a valid historical version can change the live pair while preserving the submitted-version record. Historical PDFs can be downloaded without making them live.

Legacy fit-report URLs and the master CV remain available. They do not guess which job-specific CV to return. The former CV-plus-cover-letter controls and rendering mode are removed; the standalone cover-letter route remains.

## Cost and recovery

The default published model is `gpt-5.6-sol`, with low reasoning effort and bounded output. The CV queue has concurrency one and a ten-minute compute limit. Trigger owns retries and run state. Writer and verifier outputs are separate durable child results, so native retries within the same parent run reuse paid output after a failed render or Sanity write. A saved version resumes publication without rendering again. Identical in-flight inputs reuse the claimed request and Trigger idempotency key. An explicit new generation after a terminal failure is a new billable request; it does not inherit another parent run's child checkpoints.

The existing usage ledger attributes `cv` and `cv-verify` calls to the job, request and Trigger run. Saved versions and Trigger metadata expose input/output tokens and estimated AI cost. Trigger's own billed compute is separate and must not be added to the token estimate twice. Missing pricing is reported as unavailable, not zero.

## Sanity setup

The canonical schema is `lib/sanity/studio/applicationCv.ts`. Register `applicationCvTypes` in the Studio schema. Add `applicationCvSettings` as a singleton with document ID `application-cv-settings`, exclude it from ordinary creation templates, and disable delete/duplicate/unpublish actions. Bindings and generated versions are read-only; exclude those types from creation templates and document actions.

The editable source records are employment roles, projects, speaking engagements, education and evidence. Speaking engagements use the existing project record shape so each named event is a distinct entry under **Projects & speaking**. Fit and figma-graphql are also separate entries. Each published employment role must reference one of its own approved, delivered evidence records as its broad overview. Evidence must have an original source reference, exact source passage, contribution level, delivery status, and explicit public approval. The split project and speaking facts retain the original combined published passages as provenance; no talk titles or dates are inferred. The settings document owns the model, writer/verifier prompts, word budget, minimum body size and supported layout. Missing, cross-role, proposed or unpublished overview evidence fails clearly.

CV contact details come from the published CV site page. Phone contacts require a user-approved international E.164 `tel:+...` link and an approved display label. Runtime source, public output and PDF rendering reject phone URI parameters and other unsafe contact schemes. The phone migration is deliberately data-free in the repository; it requires the exact approved number and label at execution time, checks for drafts and another published phone, and patches the CV page with a revision guard. Existing generated CV versions remain immutable; new versions include the phone after a fresh source snapshot.

```sh
node --env-file=.env.local scripts/seed-application-cv.mjs
node --env-file=.env.local scripts/seed-application-cv.mjs --apply
node --env-file=.env.local scripts/check-application-cv-source.mjs
node --env-file=.env.local scripts/update-application-cv-overviews.mjs
node --env-file=.env.local scripts/update-application-cv-overviews.mjs --apply
node --env-file=.env.local scripts/split-application-cv-projects-speaking.mjs
node --env-file=.env.local scripts/split-application-cv-projects-speaking.mjs --apply
node --env-file=.env.local scripts/add-application-cv-phone.mjs
node --env-file=.env.local scripts/add-application-cv-phone.mjs --apply
```

Seeding is additive, preserves existing published edits and drafts, and is a dry run unless `--apply` is supplied. The overview migration is also a dry run by default. It updates the five existing role references and published writer/verifier prompts in one revision-guarded transaction only when their approved source facts and old prompt pair still match; drafts or editorial changes stop it. The project/speaking migration similarly checks the original Fit and education passages, their revisions and any related drafts before replacing only those two evidence texts and creating four distinct approved entries with evidence. It is idempotent and stops for editorial review if those records changed. For the phone migration, first set process environment variables `APPLICATION_CV_PHONE_E164` and `APPLICATION_CV_PHONE_LABEL` to the owner-approved values; the commands above then dry-run or apply without embedding the personal number in repository files or command arguments. Initial setup created five employment roles, one project, one education record and 21 evidence records from the published CV and career sources; the later split adds four project/speaking records and four evidence records. Existing jobs were not backfilled.

## Delivery and verification

Local and preview apps use the named Development worker `codex/personalised-cv`; app and worker must share their Development key, branch and KV namespace. The production app must use the hosted Production worker. At release, deploy the worker with `--external-id` equal to the exact Vercel app commit SHA, then verify a request through the app. Do not disable version-skew protection.

Focused checks cover source/store/public privacy, scoped preview tokens, automatic Reviewing dispatch, manual retry and historical publication, preservation of submitted versions, failed-save recovery without repeated model execution, real PDF rendering and text extraction, and responsive admin interactions. CI runs the full suite and installs Chromium before the PDF tests. The screenshot comparison is in `docs/pr-screenshots/personalised-cv/`.

Text extraction and layout checks verify document integrity; they cannot certify ranking or acceptance by an employer's ATS. Job-specific links supplement the CV and are not required to understand its experience.
