# Edit analysis instructions in Sanity

Open the standalone Studio (`../studio-fit-app`, `npm run dev`) and select
**Analysis settings** at the top of the sidebar. The current code instructions
have been copied into this private, published singleton document.

The three tabs contain:

- **Prompts and candidate context:** full candidate evidence, compact motivation
  and interview context, shared writing rules, and prompts for fit analysis,
  cover letters, answers, research, briefs and Jev overview summaries.
- **Jev rubric and routing:** scoring and evidence-sufficiency instructions for
  all five dimensions, five rating descriptions for each, posting and constraint
  checks, writing-model selection, routine-answer routing, weights, and messages
  for limited evidence. Weights must total 100.
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
thresholds, model IDs, rate limits and orchestration remain in code. The Studio
edits instructions and rubric descriptions/weights, not executable policy.

## Maintaining the setup

For the opening and STAR answer structure used in interview briefs, see
[Interview preparation](interview-preparation.md), including the source resources,
evidence-led examples and the supplement to publish into the existing brief prompt.

`lib/sanity/analysis-defaults.js` preserves the prior behavior for offline tests,
rollback and initial creation. Updating it does not overwrite published content.
The repeatable Studio command below uses `createIfNotExists`; subsequent runs
leave the existing document untouched:

```sh
# In studio-fit-app, after deploying the schema
npx sanity exec scripts/seed-analysis-settings.mjs --with-user-token
```

The singleton ID is `fit-analysis-settings`. Publish new settings in Studio;
do not rerun a seed with replacement mutations. To roll back wording, restore a
previous Studio revision and publish it. Changes remain private to the dataset.
