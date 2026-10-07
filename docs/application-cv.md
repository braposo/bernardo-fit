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

The public page and PDF use spacing and type hierarchy to separate sections and entries, without repeated horizontal rules or visible bullet markers. Existing evidence units remain independently cited in storage and render as paragraphs; changing their presentation does not require another model call. Renderer `a4-one-column-4` also verifies extracted contact and contribution labels, clickable phone links and all approved contribution URLs. Existing saved PDF assets retain their original presentation until a new version is generated.

A failed generation leaves the previous public pair available. A `needs_review` result is a private draft with visible issues and an explicit retry action. Marking an application **Applied** pins the current version. Subsequent generation saves a candidate without replacing that publication. Explicitly publishing a valid historical version can change the live pair while preserving the submitted-version record. Historical PDFs can be downloaded without making them live.

Legacy fit-report URLs and the master CV remain available. They do not guess which job-specific CV to return. The former CV-plus-cover-letter controls and rendering mode are removed; the standalone cover-letter route remains.

## General CV source

The default CV is assembled deterministically from the same published identity, employment, education and grouped contributions as application CVs. It has no job description, fit analysis or model call. Each employment entry starts with its approved role overview. Editors may select up to two additional approved, delivered facts from that same role in the optional ordered **General CV supporting facts** field. An unset field means the overview alone; missing, duplicated, cross-role, proposed or unpublished selections fail source validation rather than silently changing the CV. The initial curated selection adds Docs v2 and SQRL to SingleStore and the design system/GraphQL work to TravelRepublic; the other three roles use their broad overviews alone. The source revision fingerprint changes when editors change these references.

`buildGeneralApplicationCv` produces the standard CV content with `variant: 'general'` and the canonical public site URL. It quotes the approved evidence verbatim, keeps the published profile and chronology, and passes the ordinary factual and word-budget checks before PDF rendering. The general URL is a site link, never a fabricated job-specific fit link.

A valid CV saved privately (for example, on an Interviewing role) is available directly from the main document card as **Saved · not live**, with authenticated preview and download actions for that exact version. The card separately tracks the current public version and latest valid saved version; drafts that need review and versions without a resolvable PDF do not supply these download actions. Generation failures or a newer version needing review do not hide an earlier valid saved CV. Publishing remains explicit for these saved versions, and opening the card never publishes or regenerates them.

## Cost and recovery

Jev chooses the writer model for each CV from the published writing-model criteria; the CV generation review has no model picker. The published CV settings model (default `gpt-6.1-sol`) is used only when Jev is not configured. Generation uses low reasoning effort and bounded output. The CV queue has concurrency one and a ten-minute compute limit. Trigger owns retries and run state. Writer and verifier outputs are separate durable child results, so native retries within the same parent run reuse paid output after a failed render or Sanity write. A saved version resumes publication without rendering again. Identical in-flight inputs reuse the claimed request and Trigger idempotency key. An explicit new generation after a terminal failure is a new billable request; it does not inherit another parent run's child checkpoints.

The existing usage ledger attributes `cv` and `cv-verify` calls to the job, request and Trigger run. Saved versions and Trigger metadata expose input/output tokens and estimated AI cost. Trigger's own billed compute is separate and must not be added to the token estimate twice. Missing pricing is reported as unavailable, not zero.

## Sanity setup

The canonical schema is `lib/sanity/studio/applicationCv.ts`. Register `applicationCvTypes` in the Studio schema. Add `applicationCvSettings` as a singleton with document ID `application-cv-settings`, exclude it from ordinary creation templates, and disable delete/duplicate/unpublish actions. Bindings and generated versions are read-only; exclude those types from creation templates and document actions.

The editable source records are employment roles, projects, speaking engagements, education and evidence. The public **Other contributions** section groups Fit under independent work, four verified public repositories under open source, and the three previously named events under speaking. Older individual open-source and speaking records remain in Sanity as provenance but are no longer approved for public output. Each published employment role must reference one of its own approved, delivered evidence records as its broad overview. The overview must retain responsibilities and supported business or organisational context so tailoring does not erase transferable experience. Company headcount growth and traffic are context, not outcomes credited to the candidate. Evidence must have an original source reference, exact source passage, contribution level, delivery status, and explicit public approval. The settings document owns the model, writer/verifier prompts, word budget, minimum body size and supported layout. Missing, cross-role, proposed or unpublished overview evidence fails clearly.

CV contact details come from the published CV site page. Phone contacts require a user-approved international E.164 `tel:+...` link and an approved display label. Runtime source, public output and PDF rendering reject phone URI parameters and other unsafe contact schemes. The phone migration is deliberately data-free in the repository; it requires the exact approved number and label at execution time, checks for drafts and another published phone, and patches the CV page with a revision guard. Existing generated CV versions remain immutable; new versions include the phone after a fresh source snapshot.

```sh
node --env-file=.env.local scripts/seed-application-cv.mjs
node --env-file=.env.local scripts/seed-application-cv.mjs --apply
node --env-file=.env.local scripts/check-application-cv-source.mjs
node --env-file=.env.local scripts/update-application-cv-overviews.mjs
node --env-file=.env.local scripts/update-application-cv-overviews.mjs --apply
node --env-file=.env.local scripts/split-application-cv-projects-speaking.mjs
node --env-file=.env.local scripts/split-application-cv-projects-speaking.mjs --apply
node --env-file=.env.local scripts/update-application-cv-contributions.mjs
node --env-file=.env.local scripts/update-application-cv-contributions.mjs --apply
node --env-file=.env.local scripts/add-application-cv-phone.mjs
node --env-file=.env.local scripts/add-application-cv-phone.mjs --apply
node --env-file=.env.local scripts/select-general-application-cv-evidence.mjs
node --env-file=.env.local scripts/select-general-application-cv-evidence.mjs --apply
```

Seeding is additive, preserves existing published edits and drafts, and is a dry run unless `--apply` is supplied. The overview migration is also a dry run by default. It updates the five existing role references and published writer/verifier prompts in one revision-guarded transaction only when their approved source facts and old prompt pair still match; drafts or editorial changes stop it. The first project/speaking split checks the original Fit and education passages before creating distinct records. The later contributions migration checks those records, the role anchors and the exact v4 published prompt pair before grouping them and publishing the v5 breadth policy. Its owner-confirmed role testimony is stored in separate candidate-evidence provenance documents beside the earlier career passages. The grouped open-source source records the repository URLs and explicitly identifies the SingleStore notes app as experimental. Both migrations retain older evidence, stop for related drafts or editorial changes, and are idempotent. For the phone migration, first set process environment variables `APPLICATION_CV_PHONE_E164` and `APPLICATION_CV_PHONE_LABEL` to the owner-approved values; the commands above then dry-run or apply without embedding the personal number in repository files or command arguments. Existing jobs were not backfilled.

The general-selection migration changes only the SingleStore and TravelRepublic role references. It requires the reviewed published evidence IDs and exact fact text, stops for related drafts or an edited selection, and uses revision guards. It is a dry run unless `--apply` is supplied; rerunning it after publication is a no-op.

## Refreshing the default CV

The default `/cv` page and `/bernardo-raposo-cv.pdf` download use one saved general CV. Refreshing it is a separate, deterministic Trigger task with no model calls. Its source fingerprint covers the approved profile, ordered general evidence, and layout settings, but excludes Sanity document revisions so saving the generated PDF does not make itself stale. The task checks for related drafts and revision changes, renders and validates one PDF, then atomically updates the page's PDF asset reference and read-only `generalCv` metadata. The previous download remains available if rendering or publication fails. Metadata records the exact PDF asset ID and checksum, source fingerprint, template and renderer versions, Trigger run ID, generation time, and zero input/output tokens and estimated AI cost. Trigger compute usage is separate. The public page requires the current download asset ID to match this saved metadata.

Run the read-only plan first. After the named Development worker has registered `general-cv-refresh` on the same branch, trigger one refresh and wait up to three minutes for its result:

```sh
node --env-file=.env.local scripts/refresh-general-cv.mjs --dry-run
node --env-file=.env.local scripts/refresh-general-cv.mjs --apply --branch codex/personalised-cv
```

The apply command requires a `tr_dev_` key and uses a global idempotency key derived from the source fingerprint and renderer/template versions. An unchanged, available PDF yields `triggered:false`. If a previous completed run used that key but the asset was later removed or invalidated, inspect that run and use `--retry-key <unique-name>` to request a new one. Do not change the retry key while a run is still active. A timeout means the task may still be running; inspect the printed Trigger run before retrying. After a completed publication, verify the `/cv` page and download on preview, including the PDF checksum and its one-page layout. This command does not deploy the app or worker. It writes the shared published Sanity CV document, so a successful refresh updates the live default PDF download even before the new reader and fallback UI are released. App and worker releases still use the normal Production release process.

### From a Claude Code cloud session

The repository's `.mcp.json` starts the Trigger.dev MCP server (`trigger.dev mcp`, pinned to the repo's CLI version, scoped to this project and the Development environment only). It authenticates with a `TRIGGER_ACCESS_TOKEN` personal access token (`tr_pat_…`) from the cloud environment; the file itself holds no secrets.

The refresh script still needs repository code and credentials in the session: run `npm ci`, and provide `TRIGGER_SECRET_KEY` (the `tr_dev_` key) and `SANITY_READ_TOKEN` for the read-only plan. The Sanity claude.ai connector does not replace that token, because the plan computes the source fingerprint with the repository's own Sanity client. The task runs on whichever Development worker is registered for the branch. To host that worker in the cloud session itself, run `npm run trigger:dev:sanity -- codex/personalised-cv` with `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`, since the image's Chromium build differs from the pinned Playwright revision. The worker needs `SANITY_WRITE_TOKEN`, from the session environment or Trigger's Development environment variables. The environment must allow `api.trigger.dev`, `trigger.dev` (MCP docs search) and `quli96gc.api.sanity.io` in addition to the npm registry.

## Delivery and verification

Local and preview apps use the named Development worker `codex/personalised-cv`; app and worker must share their Development key, branch and KV namespace. The production app must use the hosted Production worker. At release, deploy the worker with `--external-id` equal to the exact Vercel app commit SHA, then verify a request through the app. Do not disable version-skew protection.

The worker browser image uses Playwright's own installer with the resolved package version, including Chromium's headless shell and its Linux dependencies. This avoids parsing human-readable `install --dry-run` output, whose format changed in Playwright 1.63. The private `sanity-storage-probe` task accepts `configurationOnly: true, renderCv: true` to verify actual hosted rendering, font loading, one-page geometry, text and links without model calls or publishing a new CV. An empty authenticated ingestion request verifies app-to-worker dispatch without creating jobs or calling a model.

Focused checks cover source/store/public privacy, scoped preview tokens, automatic Reviewing dispatch, manual retry and historical publication, preservation of submitted versions, failed-save recovery without repeated model execution, real PDF rendering and text extraction, and responsive admin interactions. CI runs the full suite and installs Chromium before the PDF tests. The screenshot comparison is in `docs/pr-screenshots/personalised-cv/`.

Text extraction and layout checks verify document integrity; they cannot certify ranking or acceptance by an employer's ATS. Job-specific links supplement the CV and are not required to understand its experience.

## Project websites and dated presentations

`node --env-file=.env.local scripts/update-cv-project-links.mjs` plans the owner-requested content update; add `--apply` to publish it. It renames Independent work to Fit, adds its public site link, creates Hermans Club immediately below it from the published independent-work evidence, and adds three Notist links labelled with their verified 2019 event years. Existing open-source repository links remain. Fit and open-source summaries are shortened to keep the expanded CV on one A4 page at 13px.

The migration is idempotent, stops for related drafts or edited target fields, stages the new project as unpublished with a Sanity-generated ID, and uses revision guards for publication. A failed final transaction leaves the staged project unpublished so a retry can resume. The source update was applied on 2026-10-06 and a second run reported no changes. Saved CV versions and the current default PDF remain immutable until the separate general-CV refresh.

Verified presentation sources: [React Advanced London](https://noti.st/braposo/iwKalu/designing-with-graphql), [GraphQL Conf](https://noti.st/braposo/qQaBfG/making-design-more-human-with-graphql), and [Design Systems London](https://noti.st/braposo/KRU2ob/the-human-side-of-a-design-system). The approved independent-work evidence also records 2019 for all three. Project sites: [Fit](https://fit.bernardoraposo.com/) and [Hermans Club](https://www.hermans.club/).

The owner subsequently approved this current-mission description for Hermans Club: “Building Hermans Club for men’s personal development as an AI-first company, directing a fleet of specialised agents across the business.” The migration now upgrades the previous Web3-focused summary and records the exact approved wording in the independent-work source, retaining the historical paragraphs.

The subsequent `scripts/update-cv-aeminium-contribution.mjs` migration replaces SingleStore Notes with [Aeminium Labs’ Next.js Solana starter kit](https://github.com/aeminium-labs/nextjs-solana-starter-kit) in the open-source summary and project links. It is dry-run by default; add `--apply` to save. It rejects related drafts and editorial changes, guards each write by revision, and retains historical repository provenance while adding the verified starter-kit source. Applied on 2026-10-06; a second run reported no changes. The rendered CV excludes SingleStore Notes, includes the new repository link, and passes one-page A4 validation at the existing font size and spacing. Earlier migrations intentionally reject these later editorial revisions.

To retain the full approved Hermans mission on one A4 page, the owner requested a shorter Critical Software entry: “Built onAll’s web interface for wearable elderly-care sensors.” `scripts/shorten-cv-critical-summary.mjs` applies this exact edit with a revision guard, rejecting drafts, duplicates and editorial changes. It is dry-run by default; add `--apply` to save. The update has been applied and the resulting full-content PDF passes the one-page validation at the existing 13px font size and spacing.
