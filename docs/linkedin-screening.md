# LinkedIn screening settings

Open [Fit Studio](https://job-fit-app.sanity.studio/) → **Analysis settings → LinkedIn screening**. Publish changes to apply them to the next daily run. A running worker keeps one immutable snapshot.

The configuration controls the newest results per search (40 initially), preliminary Jev instructions and both choice descriptions, the minimum mismatch probability to skip (0.9 initially), request pause bounds (30–60 seconds), retry delays (5/15/30 minutes), and the request-time budget (90 minutes). Results are bounded to 1–60, pauses to 30–300 seconds, retries to at most three increasing delays of 1–60 minutes, and the budget to 1–120 minutes. An empty retry list disables retries. Longer LinkedIn Retry-After values still take precedence.

Preliminary screening rejects only clear mismatches; ambiguous or missing evidence should proceed to a full description. Final admission uses **Jev rubric and routing → Minimum job admission score**, including persisted-assessment verification. Editing preliminary instructions, criteria, candidate evidence or the rejection threshold invalidates the card-screen cache. Changing pacing or search size does not invalidate existing fit assessments.

The source of truth is `fit-analysis-settings.linkedinScreening`. A hosted LinkedIn task refuses to run without valid published settings; it never silently uses the seed defaults. Older settings documents remain usable by unrelated features. The additive seed is `node --env-file=.env.local scripts/seed-linkedin-settings.mjs --apply`; it only adds an absent object, preserves existing values and does not publish unrelated draft edits.

The canonical Studio field is `lib/sanity/studio/linkedinScreening.ts`. Copy it to `studio-fit-app/schemaTypes/linkedinScreening.ts` and apply `migration/linkedin-screening-studio.patch` to add the field and tab to Analysis settings. Build and deploy the standalone Studio. The app and Trigger worker changes require the normal merged release; publishing configuration does not deploy worker code.

Existing Redis locks, cooldowns, reports and resume state remain as established operational storage in this change. `AGENTS.md` requires Sanity for new durable application data and editable configuration; cache/coordination use of Redis must remain temporary rather than become a new source of truth.
