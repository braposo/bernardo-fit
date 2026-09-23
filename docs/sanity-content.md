# Sanity content storage

Project **Fit app (`quli96gc`)**, private dataset **`production`**. The standalone
Studio remains in **`../studio-fit-app`**, a separate repository. It is not
embedded in the app and is not required to build the app.

## Connected branch

With `SANITY_CONTENT_ENABLED=1`, the existing app endpoints and Trigger tasks
read and write Sanity for jobs, questions and answers, Jev assessments, reports
and report versions, cover letters, company research, and interview briefs.
There is no Redis content fallback or dual write in this mode. The initial
content is already imported; the importer is only a historical transfer tool,
not part of normal app operation.

Set `SANITY_ANALYSIS_ENABLED=1` alongside it. Published **Candidate profile** and
its evidence supply analysis context and confirmed facts. **Analysis settings**
supplies Jev instructions, rubrics, prompts and writing rules. Published changes
affect the next request/task attempt and invalidate generation fingerprints.
See [analysis settings](analysis-settings.md).

`SANITY_WRITE_TOKEN` must be a server-only editor credential in both the app and
workers. Reads use `SANITY_READ_TOKEN` when available, otherwise the writer.
The client pins project, dataset and API version `2026-09-22`, uses the published
perspective and bypasses the CDN. Never expose either token to browser code.

Production defaults to the existing Redis backend until these flags are enabled
in its app and workers. Merging the branch alone does not change that setting.
The branch preview uses the real production Sanity dataset, so editorial changes
made there are persistent and visible in Studio.

## Branch workers

The app preview can target either a hosted Preview worker or a named Development
worker. Development testing uses `SANITY_WORKER_ENV=development`, the existing
development `TRIGGER_SECRET_KEY`, and `TRIGGER_PREVIEW_BRANCH=codex/sanity-content-setup`.
Run `npm run trigger:dev:sanity` on this computer; it starts that isolated dev
branch with `KV_NAMESPACE=sanity-preview`. The computer must remain awake and
the process running. This does not require enabling hosted Preview branches.
The CLI uses Development environment credentials and ignored local env files;
add missing development provider keys to `.env.development.local`.

A hosted Preview worker instead uses its Preview key with
`SANITY_WORKER_ENV=preview` and the matching `TRIGGER_PREVIEW_BRANCH`.
Both modes require `SANITY_WORKERS_READY=1` in the app after verification. Until ready, keep
`SANITY_WORKERS_READY=0`: jobs remain editable but task dispatch returns an
explicit setup error, avoiding accidental dispatch to the production workers.

The Trigger Preview environment needs the same Sanity flags and editor access,
plus its normal model/provider and operational Redis credentials. The build
extension syncs the Sanity settings only for an explicitly enabled Preview
deployment. It does not change production worker settings.

Use the same `KV_NAMESPACE=sanity-preview` for the app and Preview workers to
separate their Redis locks, run receipts, audit, usage and admission limits from
production. These operational records intentionally remain in Redis; Sanity is
the source of editorial content. The development probe can run without Redis.

### Realtime notifications preview

The realtime notifications branch targets a named Trigger Development worker:
SANITY_WORKER_ENV=development, TRIGGER_PREVIEW_BRANCH=codex/realtime-task-toasts,
and KV_NAMESPACE=realtime-preview. The app and worker both enable Sanity content
and analysis settings, use editor access to the same dataset, and share the
Development Trigger key. Start its worker with:

```sh
npm run trigger:dev:sanity -- codex/realtime-task-toasts realtime-preview
```

The worker process and computer must stay running for queued tasks to execute.
This uses the same task code and published Sanity inputs as production, with
separate Trigger runs and operational Redis keys. Preview apps cannot dispatch to
production workers, even if the preview’s Sanity flag is accidentally missing.

## Editing and consistency

- Publish Studio edits before using them in the app. App saves reject affected
  records with unpublished drafts rather than overwrite the draft's base.
- Sanity revision guards preserve concurrent edits. Explicit stale app versions
  fail with a conflict; background patches retry against current content.
- A singleton allocation registry serializes logical identities while Sanity
  generates ordinary document IDs. Generation retries reuse the same version.
- Existing app IDs and shared report URLs remain unchanged. Active pointers and
  historical versions are preserved. Removing a job or artifact soft-deletes its
  content; public reports can remain available. `publiclyShared=false` hides a
  report from the public API, including after regeneration.
- Structured fields are canonical. Hidden source snapshots exist for recovery;
  clearing an editorial field does not resurrect its imported value.
- Pre-Sanity assessments remain current only when their original scoring hash
  still matches the role, the published settings equal the original settings,
  and the candidate/evidence signature exactly matches the imported snapshot.
  This preserves saved scores and matching Overview summaries across the
  migration without rewriting provenance or rerunning models. Real editorial
  changes still invalidate them. New assessments use the current fingerprint.

## Inspect and verify

Authenticated `GET /api/admin/content` reports the active backend and document
counts. `?type=job&offset=0` lists records, and `?type=job&id=<Sanity document ID>`
resolves questions and related artifacts. It requires the existing admin secret.
The ordinary `/api/admin/jobs` and artifact endpoints exercise the live adapter.

```sh
# In fit-app, with local server credentials
npm run sanity:check
npm run sanity:settings:check
npm run sanity:storage:check

# In the standalone sibling studio-fit-app
npm run dev
npm run typegen
```

The storage check creates uniquely named disposable records and removes only
those fixtures. It exercises Studio-to-app reads, app writes, concurrent writes,
draft conflicts, versions, privacy, rich text, citations, active pointers and
deletion. `sanity-storage-probe` runs the same check inside a real Trigger worker
without calling a paid model. TypeGen writes the app's committed
`lib/sanity/sanity.types.ts`; app CI does not require the sibling checkout.

## Remaining migration scope

The [import inventory](../migration/README.md) documents available historical
content and the limits of the old export. A raw Redis reconciliation could find
unindexed records that were absent from that export. This does not prevent the
app from using the content already in Sanity.

Homepage/CV documents and the CV file asset have been imported, but their static
public renderers still use checked-in files. Interface labels and error messages
also remain in code. Those are separate from the connected job and analysis flow.
Before production activation, reconcile any new content created by the old
production app since the initial export, verify public links, and coordinate the
app and worker configuration. Retain the source snapshot for rollback.
