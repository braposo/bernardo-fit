# Edit analysis instructions in Sanity

Open the standalone Studio (`../studio-fit-app`, `npm run dev`) and select
**Analysis settings** at the top of the sidebar. The current code instructions
have been copied into this private, published singleton document.

The settings tabs contain:

- **Prompts and candidate context:** full candidate evidence, compact motivation
  and interview context, shared writing rules, and prompts for fit analysis,
  cover letters, answers, research, briefs and Jev overview summaries.
- **Jev rubric and routing:** scoring instructions for all five dimensions,
  five rating descriptions for each, posting and constraint checks,
  writing-model selection, routine-answer routing, minimum job admission score and weights. Weights must
  total 100. The existing Studio document also retains five legacy `*Known`
  entries and dimension `gap` messages for schema compatibility. Fit assessment
  no longer requests these checks, applies their caps or displays their messages;
  editing them does not change fit freshness.
- **Request lifecycle:** published provider HTTP timeouts, native Trigger retry options and conversation-persistence timeout/retries. See [request lifecycle](trigger-lifecycle-review.md).
- **LinkedIn screening:** preliminary Jev instructions and criteria, rejection probability, search size, request pacing, native Trigger retry policy and HTTP timeout. See [LinkedIn screening](linkedin-screening.md).
- **Confirmed facts:** exact factual answers that may bypass a model, the list
  of routine motivation questions, and personal facts used in interview briefs.

Edit, then **Publish**. Draft edits do not affect analysis. Keep app keys, answer
types, choice identifiers and the five-level rubric shape intact. Prompt tokens
such as `{{candidateProfile}}` and `{{slopTop}}` insert the other editable entries;
`{{coverMaxWords}}` and `{{refusal}}` are app contracts. Output JSON fields and
refusal formats must remain compatible with the app. No published text executes
as JavaScript. Runtime validation rejects incomplete or incompatible settings.

With `SANITY_CONTENT_ENABLED=1`, edit candidate context in **Candidate profile**
and its referenced **Candidate evidence**, including motivation/interview
summaries, confirmed answers and personal facts. Those fields supersede the
duplicate candidate entries retained in Analysis settings for legacy operation.
Jev instructions, rubric, prompts and shared writing rules still come from
**Analysis settings**. The optional `writingGuidance` type is not a runtime source.
Jobs and generated artifacts also use Sanity in this mode; static public home/CV
renderers remain file-backed. See [content storage](sanity-content.md).

## Activation and deployment

The local app has `SANITY_READ_TOKEN` and `SANITY_ANALYSIS_ENABLED=1` in its ignored
`.env.local`. `npm run sanity:settings:check` fetches the published document and
builds real task inputs without spending on a model or printing candidate content.

Production requires the updated web app **and** Trigger.dev workers. Deploy them
together after the PR is merged. For full content storage both environments need
`SANITY_CONTENT_ENABLED=1`, `SANITY_ANALYSIS_ENABLED=1` and a server-only editor
`SANITY_WRITE_TOKEN` for project `quli96gc`, dataset `production`. A viewer token
alone is sufficient only for the legacy analysis-settings-only mode.
Branch-specific Vercel Preview settings enable the new content backend; production
settings and workers remain unchanged. A matching named Development worker can
serve branch tests while this computer stays awake, or a hosted Preview worker
can serve them independently. Verify the chosen worker before setting
`SANITY_WORKERS_READY=1` in the app; see the content storage guide.
The flag defaults off until that coordinated activation; when off, the preserved
code baseline is used. When on, a failed fetch or invalid/missing published settings
returns an error rather than silently using obsolete instructions.

## Snapshots, retries and staleness

**Minimum job admission score** starts at **50/100** and accepts integers from
0 to 100. A score equal to the minimum passes, subject to posting validation and
hard constraints. Publish the field under **Jev rubric and routing** to change it.
Each new ingest batch saves the published value; retries keep that saved policy.
Changing only this field does not invalidate scoring or generated content.
The old `JEV_INGEST_MIN_SCORE` environment variable is ignored. Older documents
without the field, and offline baseline operation, use 50; malformed values fail
validation. Seed the existing published singleton with
`node --env-file=.env.local scripts/set-ingest-minimum-score.mjs --apply`.
The script also updates the field on an existing draft without publishing other
draft edits. Apply `migration/admission-threshold-studio.patch` in the standalone
Studio and deploy it. Deploy the app and worker after the PR is merged.

Each authenticated API request and task attempt loads one immutable published
snapshot. Concurrent tasks cannot mix snapshots. A publication affects the next
request/attempt; an already-running attempt finishes with its original snapshot.
There is no process-wide settings cache or webhook delay.

Settings content participates in scoring, generation-review, model-routing,
analysis, cover, answer, research and brief fingerprints. An edit conservatively
invalidates these reuse paths, marks old assessments stale, and requires a fresh
review. Jobs are not automatically reassessed and publishing does not spend model
credits. A queued job whose reviewed fingerprint no longer matches is superseded
before generation; a running task's output retains its original fingerprint and
will be considered stale on the next read. A retry loads current settings and
cannot attach a checkpoint from a different settings fingerprint.

Output parsing, TypeSafe response validation, score calibration, probability
thresholds for full-fit scoring, model IDs and orchestration remain in code. LinkedIn screening and request-pacing settings are editable as documented above. The Studio
edits instructions and rubric descriptions/weights, not executable policy.

## Remote preference and model confidence

The Practical compatibility instructions and rating descriptions favour
explicit UK remote work from Harrogate over otherwise comparable arrangements
requiring regular office attendance. Optional office access and occasional
company visits remain compatible with remote work. Workable regular commuting
is a trade-off; foreign-only remote roles are not assumed to permit UK work.
Keep the candidate profile's `workingPreferences` aligned with that preference.
The five weights and the existing guards for weak core fit, incomplete postings
and explicit hard constraints remain unchanged.

Each dimension uses the reported fit rating directly. Model confidence is kept
separate: the admin highlights values below 70%, or unavailable confidence,
as a Review rating cue without changing scores or declaring information missing.
The Overview prompt must not invent missing facts or capability gaps to explain
confidence values, and must distinguish essential requirements from bonuses.

The `2026-09-29-context-evidence-1` scoring policy makes older assessments
outdated while retaining their saved scores and provenance. An explicit
reassessment produces new scores and a matching Overview summary; publication
of instructions never triggers that model work by itself.

## Assessment context and dimension boundaries

Scoring and the Overview receive the same candidate snapshot, job-specific
instructions, recruiter notes, company, role, full description, location,
location mode and salary. Notes can supply factual clarifications omitted from
structured fields. A recruiter salary discussion remains tentative; it is not
a confirmed offer or necessarily base compensation. Notes cannot override the
rubric, and candidate optimism or recruiter enthusiasm does not establish fit.
Conflicting sources remain uncertain unless a later clarification is identified.

Candidate context includes the profile summary, referenced evidence, headline,
location, availability, work eligibility, notice period, career direction,
working preferences, salary preferences and constraints. Application stage,
recruiter contact details and previous generated assessments are not fit evidence.
Changing any included job field invalidates scoring reuse and generation review;
editing notes while scoring or summarising prevents a stale result from attaching.

Across all five dimensions, missing detail affects confidence rather than
automatically forcing a lower rating. Strong ratings still need relevant positive
evidence. With no usable evidence at all, use a neutral midpoint and low confidence.

- Responsibilities use actual duties, without inferring a management/coding split
  or direct reports from a title.
- Evidence uses essential capabilities and delivered work. A requested portfolio
  is an application follow-up; its absence from context does not erase documented
  experience. Do not assume the portfolio exists or treat bonuses as essentials.
- Scope uses ownership, complexity and influence, without assuming a Principal
  title requires manager-of-managers experience.
- Direction retains Engineering Manager as the first preference while recognising
  the explicitly acceptable senior IC and smaller-company leadership paths.
- Practical compatibility credits supported UK remote arrangements. Unknown pay
  or hours do not themselves negate that fit; explicit country restrictions,
  required attendance and other supported conflicts still matter. A distributed
  company alone does not establish that a particular role permits UK work.

Count a concern in multiple dimensions only when it independently affects each.

## Maintaining the setup

For the opening and STAR answer structure used in interview briefs, see
[Interview preparation](interview-preparation.md), including the source resources,
evidence-led examples and the supplement to publish into the existing brief prompt.

`lib/sanity/analysis-defaults.js` supplies the baseline for offline tests and
initial creation. Updating it does not overwrite published content.
The repeatable Studio command below uses `createIfNotExists`; subsequent runs
leave the existing document untouched:

```sh
# In studio-fit-app, after deploying the schema
npx sanity exec scripts/seed-analysis-settings.mjs --with-user-token
```

The singleton ID is `fit-analysis-settings`. Publish new settings in Studio;
do not rerun a seed with replacement mutations. To roll back wording, restore a
previous Studio revision and publish it. Changes remain private to the dataset.
