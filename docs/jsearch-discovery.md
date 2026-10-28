# JSearch discovery

Daily discovery has a second source beside the public LinkedIn scan: [JSearch](https://www.openwebninja.com/api/jsearch), an API over Google for Jobs. One search covers LinkedIn, Indeed, Glassdoor, Reed and employers' own careers pages, and every result carries its full description, so no second request is needed per posting.

## How a run works

The `jsearch-discovery-schedule` task (Production only) dispatches `jsearch-job-discovery` at **09:15 Europe/London**, one run per London date. Both discovery tasks share the `job-discovery` queue with a concurrency of one, so the JSearch run waits for the 09:00 LinkedIn scan to finish and the two sources never admit the same new job at once.

1. **Search.** Each published search requests up to `pagesPerSearch` pages of ten results (`jsearch-request` child task, one paid request per page). A short page ends that search.
2. **Identity.** A result that LinkedIn also lists takes the LinkedIn identity (`linkedin-<id>` and the canonical `/jobs/view/<id>` link), so the LinkedIn scan, the pipeline, the archive and Filtered all recognise it. Other results use `jsearch-<hash>` and the employer's direct apply link where JSearch has one.
3. **Known postings.** Postings seen in the last 30 days (`jsearch-discovery:state` in KV), postings already in the pipeline or archive, and results without a description are skipped before any model call.
4. **Card screen.** The same Jev card screen as LinkedIn drops confident mismatches. Because the description is already in hand, uncertain cards go on to the full assessment instead of being deferred. Likely reposts skip the screen and go to the repost check.
5. **Assessment.** At most `maxAssessmentsPerRun` postings go through the normal ingest batch: repost check, full Jev assessment, the published minimum score, and Filtered for scored rejections. Postings over the cap stay unprocessed and are reached by a later run while still inside the posted-within window.

Jobs keep `source: "JSearch · <board>"`, so the pipeline shows where each one was found. A run with failed searches, failed screening or a failed assessment ends as incomplete; unfinished postings are retried the next day. The run report is saved for 90 days at `jsearch-discovery:report:<run id>`.

## Setup

1. Create an OpenWeb Ninja account on the pay-as-you-go plan and add the key as `JSEARCH_API_KEY` to the Trigger.dev **Production** and **Development** environments. A RapidAPI key for the same API also works as `JSEARCH_RAPIDAPI_KEY`. The key is read only inside the `jsearch-request` worker.
2. Merge and let Trigger Production deploy.
3. Seed the settings, disabled, preserving anything already published:

   ```sh
   node --env-file=.env.local scripts/seed-jsearch-discovery.mjs          # dry run
   node --env-file=.env.local scripts/seed-jsearch-discovery.mjs --apply  # adds disabled defaults where missing
   ```

4. Check one manual run in Production (trigger `jsearch-job-discovery` with `{ "date": "<today>" }` and a fresh idempotency key) with `enabled` set to true, then leave it enabled for the schedule.

## Settings

`fit-analysis-settings.jsearchDiscovery` is published policy. While it is unpublished or `enabled` is false, the run stops before any paid request.

| Field | Default | Meaning |
| --- | --- | --- |
| `searches[]` | Engineering Manager, Head of Engineering in the UK | `query` (free text), `country` (two-letter code), `datePosted` (`today`, `3days`, `week`, `month`) |
| `pagesPerSearch` | 2 | Pages of ten results per search, each a paid request |
| `maxAssessmentsPerRun` | 20 | Full Jev assessments per run |
| `requestTimeoutSeconds` | 30 | Per request |
| `retry` | 3 attempts, 1 to 15 minutes | Native Trigger retry for each request; `Retry-After` is honoured |

At the defaults a run makes at most four requests, about $0.02 at pay-as-you-go rates. Settings changes do not mark fit assessments outdated.

## Studio

The canonical field is `lib/sanity/studio/jsearchDiscovery.ts`. In the standalone Studio, add it to the Analysis settings document in the LinkedIn group beside `linkedinScreening`. The app reads the published value whether or not the Studio field is deployed.
