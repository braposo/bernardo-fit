# Application checklist at Reviewing

Moving a job into Reviewing requests the existing check-posting Trigger task alongside fit-page and CV generation. The check now prepares the application rather than generating questions about missing salary, office days or team size.

1. Reuse an ATS link already saved with the job; otherwise search for the exact employer vacancy using published Sanity discovery policy. Accept only a URL present in search evidence, excluding LinkedIn and known aggregators. No candidate data is sent to search.
2. Inspect the public application page in an isolated browser, following explicit Apply links. Read contact fields, files, screening questions, choices, required markers and character limits. Never fill, upload, consent or submit. Browser requests are read-only and public HTTPS hosts are checked before navigation and subresource access.
3. If browser inspection fails, use supported public ATS APIs as a partial fallback. Login, later steps, unreadable controls, missing submit controls and truncated forms remain incomplete. Search cannot guarantee vacancy identity; the employer link is shown for checking.
4. Save the checklist in the job's existing Sanity runtime state, with revision-guarded mutations. Preserve user confirmations during retries and concurrent writes. A failed save reuses checkpointed model calls and child results through Trigger idempotency.
5. Reuse the existing answer writer once the fit report exists. Published exact profile answers can be suggested; personal questions, choices, contacts, consent and files need confirmation. Required items cannot be skipped. Confirmed answers can be copied into the real form. File confirmation records the prepared filename, not an upload.

The UI reports prepared item counts and partial-inspection limitations. Readiness requires a completely inspected form, every required field approved, and optional fields approved or explicitly skipped. A missing/empty/unreadable form does not count as ready. Pasted fields remain a manual, unverified checklist. Legacy gap actions remain compatible with old records, but new runs and Needs you no longer generate/display gap requests.

## Policy and deployment

Published fit-analysis-settings.postingCheck owns enabled, fetchApplicationForms, draftAnswers, maxDraftAnswers, requestTimeoutSeconds, discoveryPrompt, discoveryModel and maxDiscoverySearches (1?8). The legacy gapThreshold is retained for compatibility and no longer used. Settings use the existing server settings loader and cache invalidation. Policy version changes invalidate saved automatic checks; explicit re-run refreshes a job after editorial changes.

Run scripts/seed-application-discovery.mjs first without flags to preview, then with --apply to add only missing published discovery policy. It uses a revision guard and leaves existing edits and drafts untouched. Missing discovery policy fails clearly; hosted workers never substitute repository defaults. The original seed still creates disabled defaults for an initial installation.

Deploy the app and the hosted Production worker together, including application-form-request, with the exact Vercel commit SHA as Trigger --external-id. Local and preview verification uses a named Development worker. No Production deployment is performed merely by opening the PR.

## Lifecycle and limitations

Search and answer generation use durableModelCall; provider child tasks own retries. The application-form-request child owns browser attempt retries (two attempts), task duration and concurrency. Playwright navigation/DOM deadlines are per-read transport boundaries, not a custom retry engine. The existing browser build extension supplies Chromium to hosted workers. Reading refuses write requests, so applications relying on POST-based schema loading may need manual inspection.

Dynamic conditional fields, custom widgets, CAPTCHA, login and later steps can require user inspection. No inferred generic requirements are inserted when the real form cannot be read. This change prepares data only and never submits an application.
