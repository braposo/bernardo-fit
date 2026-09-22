# Sanity content preparation

Project **Fit app (`quli96gc`)**, dataset **`production`**. The dataset is private.
The standalone Studio is in **`../studio-fit-app`**, a separate repository.
It is not embedded in this app and the app does not need Studio files to build.

## Current behavior

Jobs, artifacts and site content remain in the preparation stage. The owner
subsequently requested importing and wiring analysis instructions: the published
**Analysis settings** document now contains the current prompts, candidate context,
Jev rubric, routing and factual shortcuts. See [editing analysis settings](analysis-settings.md)
for publishing and coordinated web/worker activation. No jobs or artifacts were imported.

The app now has a server-only, published-content reader and an authenticated
`GET /api/admin/content` endpoint. The endpoint uses the existing `x-admin-secret`
authentication and disables response caching. With no query it returns connection
status and published document counts. `?type=job&offset=0` lists up to 50 records;
`?type=job&id=<Sanity document ID>` resolves its active artifacts and questions.
Candidate profile reads resolve referenced evidence. Other registered types can
be listed and read with the same parameters. Draft/release IDs are rejected.
There is no public route exposing this private content and no write endpoint.

## Local connection

A viewer token is stored in the app's ignored `.env.local` as `SANITY_READ_TOKEN`.
The client pins the supplied project, dataset, and API version `2026-09-22`.
It reads published documents directly from the API without the CDN. Never put
the token in browser code or a public-prefixed environment variable.

```sh
# In fit-app
npm run sanity:check
node tests/run.mjs sanity

# In sibling studio-fit-app
npm run dev
npm run typegen
```

`sanity:check` executes counts and list queries against the real private dataset.
An empty dataset is a successful connection, not a signal to replace existing data.
TypeGen runs from the Studio and writes `lib/sanity/sanity.types.ts` here. Commit
that generated file after schema/query changes; app CI does not need the sibling
checkout. The local connection does not install credentials in Vercel or Trigger.dev.
Before enabling server reads there, provision separate viewer tokens in their
server environment settings. Future app mutations need a separately scoped write
credential; do not widen the viewer token now.

## Content inventory and target model

| Current source | Sanity document | Relationships / intended use |
| --- | --- | --- |
| `lib/profile.js`, compact profiles and confirmed facts in answer/brief/scoring code | `candidateProfile`, `candidateEvidence` | Profile references reusable evidence; structured preferences and confirmed answers |
| Job records in `lib/store.js` | `job` | Posting, recruiter, notes, instructions, source identity, stage; references candidate and active artifacts |
| Embedded application questions and answers | `applicationQuestion` | References owning job; ordered questions with answer, limit and refusal reason |
| Saved fit reports and version history | `fitReport` | One document per version; job reference; private reasoning separate from shareable fields |
| Cover artifacts and legacy embedded letters | `coverLetter` | One document per version; job reference and Portable Text body |
| Research artifacts | `companyResearch` | Job reference; source objects and evidence points retaining source keys |
| Interview brief artifacts | `interviewBrief` | Job/research references; conversation, questions, evidence and source snapshots |
| Jev assessments | `fitAssessment` | Job reference; score, dimensions, reasoning, policy and input fingerprint |
| Home/CV copy in `public/` | `sitePage` | Slug, metadata, Portable Text and optional candidate reference |
| Editorial guidance currently in prompt code | `writingGuidance` | Guidance by generation scope; executable output contracts remain code |

Documents use Sanity-generated IDs. `legacyId`/`versionId` retain source identity
for a future migration; references use actual Sanity IDs, not constructed IDs.
Owned arrays use `_key`; research evidence `sourceKey` points to a source object's
`_key`. Rich editorial bodies use Portable Text. Original job postings remain
plain source text. No files or images are uploaded; Sanity asset URLs remain
public even with a private dataset, so private attachments need a separate plan.

Operational counters, admission limits, task locks, run receipts, telemetry,
usage and audit logs stay in their current operational stores. They are not
editorial content. This setup does not replace transactional worker coordination.

## Cutover after content is added

1. Review the model using real examples, including archived jobs, source citations,
   historical versions, recruiter fields, structured assessment details and CV sections.
   The preparation schemas are not a lossless migration adapter yet.
2. Decide manual authoring versus import. If importing, export a snapshot first,
   count each source type, retain original IDs in fields, transform Portable Text,
   create dependencies, then resolve references. No import was run during setup.
3. Build and test read/write adapters for jobs, questions and artifact versions.
   Preserve compare-and-set behavior, retries, idempotent generation, report
   revision checks, history and active-version selection. Avoid uncoordinated
   dual writes to Redis and Sanity. Resolve Studio draft/publish conflicts with
   worker edits before enabling writes.
4. Move all candidate consumers together: full profile, motivation and interview
   summaries, exact factual answers, brief personal facts, scoring preferences
   and generation fingerprints. A published profile edit must invalidate stale
   assessments and reuse caches; missing evidence must not become invented facts.
5. Wire the public home/CV renderers and preserve existing permalink IDs. Keep
   public report projections explicit so notes, research and private reasoning
   never leak through public endpoints. Add redirects only if URLs change.
6. Compare counts, content, references and active versions; test generation,
   concurrent writes, archive/delete, public sharing and browser navigation.
   Freeze content writes briefly for a final delta sync before changing the
   active storage path. Retain the original snapshot for rollback.

Until content storage cutover is implemented and verified, editing the prepared
content types does not change the live app's jobs or artifacts. Analysis settings
are separately wired to generation when enabled; see the activation guide above.
