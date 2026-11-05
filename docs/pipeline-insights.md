# Pipeline insights

The admin **Dashboard** (`/admin`, the admin home; formerly the Insights view) opens on what needs Bernardo (the Needs you items) and where every role is right now, each linking into the matching Jobs tab or stage. Below that it shows how roles move through the pipeline: where they drop out, how long each stage takes, what is waiting and what changed recently. It is read-only and derived; nothing new is stored.

## Data

`GET /api/admin/jobs?overview=1&range=7|14|30|90` (default `30`; 1 week, 2 weeks, 30 days, 3 months) returns the overview built by [`lib/pipeline-overview.js`](../lib/pipeline-overview.js). Its inputs:

- **Job records** (all of them, archived included): stage, `createdAt`, `archived`, `score`, `source`/`sourceType`, `interviewTimeline`.
- **Recorded audit events** (`audit:job:<id>`, read with `readJobEvents` in [`lib/job-audit.js`](../lib/job-audit.js)): `job.created`, `status.changed`, `agent.moved`, `interview.added`. Only roles the view can show are read: the range's roles, open roles and anything touched during the range, the weekly chart or the activity window.
- **Filtered records** (Sanity `filteredJob`, read with `listFilteredDates`): the first time each role was screened out. Records moved to the pipeline count as pipeline roles; cleared ones still count as screened out. Retention (Analysis settings) removes old records, so a range longer than retention undercounts screening; the view says so.

## Definitions

- **Range cohort.** Roles added (`createdAt`) inside the range, plus roles first screened out inside it. "All time" uses every role.
- **Journey.** Each role's stages come from its recorded `status.changed` events. A role counts as having reached every stage up to the furthest one it got to, so a role moved straight from New to Applied has also passed Reviewing. A role whose audit began with it has complete history. For older ("legacy") roles only later changes are known; a legacy role that closed with no recorded change is **inferred**: rejected roles are placed at Applied (Interviewing when they have interview entries), and not interested or expired roles at New. The view states how many roles were inferred.
- **Dropped.** A closed role (rejected, not interested, expired) or one archived while still open leaves the flow at its furthest stage. **Still here** counts open roles whose journey has so far stopped at that stage.
- **Conversion.** Reached this stage ÷ reached the previous one. New is measured against everything discovered (pipeline + screened out).
- **Median time in stage.** From recorded entry to recorded exit, over roles that left the stage. Time to apply is from `createdAt` to the recorded move to Applied.
- **Waiting longest.** Open roles past New, by time since their recorded entry into the current stage (top six). Roles without a recorded entry date are left out rather than guessed.
- **Recent activity.** The last 30 days of additions, stage changes (marked when the review agent made them) and interviews, newest first (at most 40). Items after the previous visit are marked **New**; the visit time is kept in this browser's `localStorage` (`fit.insights.seenAt`), not on the server.
- **Intake chart.** One bar pair per day for ranges of two weeks or less (`intakeDays: 1`), otherwise per week (`intakeDays: 7`, 4 to 26 weeks).
- **Pipeline now and tab counts.** `counts` gives the current active, archived and Filtered totals; `kpis.activeByStage` the active roles per stage. They ignore the range. Needs your attention reads `GET /api/admin/jobs?needsYou=1`, like the Needs you tab.
- **Sources.** LinkedIn, Job boards, Email, Fit website or Other, from `source`/`sourceType`.

## UI

Browser helpers live in [`public/pipeline-insights.js`](../public/pipeline-insights.js) (flow layout and SVG, weekly bars, formatting, activity grouping); [`public/admin.html`](../public/admin.html) loads and renders the view. Design rules are in [DESIGN.md](../DESIGN.md#pipeline-and-navigation).

The flow chart encodes one distinction in colour: roles that moved on (accent `#6055a6`) versus roles that dropped (`#ae4554`); screened out is neutral grey. Every node carries a direct label and the Stage by stage table repeats the numbers, so nothing depends on colour or hover. The weekly chart uses accent for Added and `#c46a1e` for Applied. These pairs pass the dataviz palette validator (lightness, chroma, colour-vision separation, contrast).

## One role's timeline

Each role's Overview shows its own **Timeline** from the same recorded `status.changed`, `agent.moved` and `job.archived` events: `GET /api/admin/jobs?id=<id>&journey=1`, built by [`lib/job-journey.js`](../lib/job-journey.js). It returns every stage with its entry and exit dates and duration (the current one up to now), whether the review agent made the move, the latest move to Applied (and how many there were), days from added to first application, total time in the pipeline (until it closed or was archived) and, for legacy roles, when recording began. Legacy roles' earlier stages have no dates and are never timed. The browser keeps the result per role until its stage or archive state changes.

## Tests

`node tests/test-pipeline-overview.mjs` (server derivation and endpoint), `node tests/test-job-journey.mjs` (one role's timeline) and `node tests/test-pipeline-insights.mjs` (layout and formatting).
