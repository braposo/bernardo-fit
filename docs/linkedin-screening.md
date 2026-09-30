# LinkedIn screening settings

Open [Fit Studio](https://job-fit-app.sanity.studio/) → **Analysis settings → LinkedIn screening**. Publish changes to apply them to the next daily run. A running worker keeps one immutable snapshot.

The configuration controls newest results per search (40 initially), preliminary Jev instructions and choice descriptions, mismatch probability (0.9), request pause bounds (30–60 seconds), HTTP timeout (25 seconds), and native Trigger retry options. Initial retry policy allows four total attempts with a five-minute minimum, thirty-minute maximum, factor three and native randomization. Set maxAttempts to one to disable retries. Standard Retry-After seconds or HTTP dates map to Trigger's retryAt.

Preliminary screening rejects only clear mismatches; ambiguous or missing evidence should proceed to a full description. Final admission uses **Jev rubric and routing → Minimum job admission score**, including persisted-assessment verification. Editing preliminary instructions, criteria, candidate evidence or the rejection threshold invalidates the card-screen cache. Changing pacing or search size does not invalidate existing fit assessments.

The source of truth is `fit-analysis-settings.linkedinScreening`. A hosted LinkedIn task refuses to run without valid published settings; it never silently uses the seed defaults. Older settings documents remain usable by unrelated features. The additive seed is `node --env-file=.env.local scripts/seed-linkedin-settings.mjs --apply`; it adds missing fields, migrates legacy retry delays into native options, preserves existing values and does not publish unrelated draft edits.

The canonical Studio field is `lib/sanity/studio/linkedinScreening.ts`. Copy it to `studio-fit-app/schemaTypes/linkedinScreening.ts` and apply `migration/linkedin-screening-studio.patch` to add the field and tab to Analysis settings. Build and deploy the standalone Studio. The app and Trigger worker changes require the normal merged release; publishing configuration does not deploy worker code.

Each HTTP request runs in a child Trigger task. Trigger owns retry scheduling, durable pacing, request timeout and cancellation. The parent has one attempt; failed requests retain pending work for a later daily run. Native maxDuration limits compute time (60 seconds per request task and 7,200 seconds for discovery), not elapsed time spent waiting. The old 90-minute wall-clock budget and Redis cooldown ledger are retired. Legacy Sanity fields remain hidden for migration/audit.

Source ownership survives durable waits and is reclaimed only after Trigger reports its owner terminal. Existing Redis reports and resume state remain established operational storage; AGENTS.md requires Sanity for new durable application data and editable configuration. Cancellation can end an outstanding provider cooldown; resume manually only when appropriate.
