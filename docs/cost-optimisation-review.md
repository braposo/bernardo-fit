# Token cost review — 9 September 2026

## Branch review — 18 September 2026

The review branch is based on updated master, including the merged Sol/Astra integration and structured screen-copy fix. The original branch predates both merges. Integration preserves the existing OpenAI long-prompt pricing threshold (over 272,000 combined input/cache tokens), including Sol's distinct cache-read multiplier, with regression tests at and above the threshold.

Implemented scope: exact factual answer shortcuts, optional compact motivation answers, shared prompt cache prefixes, explicit effort, retry classification, recorded per-request generation/search allowances, equivalent in-flight dispatch claims, semantic brief inputs, no-op edit handling, and usage breakdowns. The existing Sol default is unchanged.

Remaining work, in priority order:

1. **Validate quality before expanding economy routing.** Compare the same representative questions with economy on/off through the actual provider APIs. Score factual support, voice, uncertainty, word limits and rewrite rate; record usage per accepted answer. The default-enabled browser preference currently ships without this controlled comparison. The local comparison-page helper is an editorial tool, not evidence of API savings.
2. **Measure production behavior after rollout.** Deploy matching web and Trigger worker versions, then check attribution, duplicate dispatch recovery, errors, cache reuse and estimated cost against provider billing. The new fingerprint policies can supersede already queued work, so drain old runs before switching worker/web versions. No production deployment is part of this review.
3. **Decide whether a hard spending ceiling is required.** Current cover/research allowances read best-effort usage history. Telemetry write failures or a worker crash after a provider request can leave an unrecorded call, and concurrent executions can read the same allowance. These are cost-reduction controls, not atomic reservations or a monetary limit. A hard ceiling requires a separate durable reservation ledger with explicit failure/reconciliation rules.
4. **Finish per-artifact measurement.** Daily operation/model/effort totals are available, but cost per completed artifact, retry/regeneration rates and comparison cohorts still need aggregation. Historical unpriced calls remain excluded from estimates. Verify dated provider prices before using estimates for budget decisions.
5. **Tune only with evidence.** One-hour cache TTL, lower effort for detailed work, shared company research, overnight batches and smaller prompts remain experiments. Keep each change separate so quality and cost effects can be attributed.

This review used mocked targeted tests; it did not purchase model generations or measure real savings. The earlier validation totals below describe the original branch author's run, not a new full local test run. GitHub PR checks are authoritative for the integrated branch.

---

**Implementation update.** The changes below are now implemented locally. The original audit follows for context.

- The admin defaults to an optional economy-answer path: exact supported facts skip the model; a narrow set of motivation questions uses Sonnet/medium plus existing fit evidence. Complex questions and custom instructions retain the selected model and full profile. Turning off the preference restores full-context generation for comparison.
- Compact motivation prompts contain 537 fixed words / 3,577 characters, versus 6,007 words / 37,157 characters on the full path: 90% fewer fixed characters. This is a prompt-size measurement, not a measured billing reduction. Job-specific context is additional.
- Full-profile generators share an exact cached prefix without duplicating the profile, and answers additionally cache unchanged role context. The default TTL is still five minutes; one-hour caching is configurable.
- Provider errors retain upstream status for retry decisions; truncation and exhausted parsing stop automatic regeneration. Recorded usage carries letter and research budgets across worker retries. Atomic admin claims share equivalent in-flight work while preserving deliberate rewrites after completion.
- Brief fingerprints use model evidence rather than run metadata. No-op field/question edits preserve freshness. Brief generation now also honors the trusted role instructions that participate in its fingerprint.
- The admin Usage dialog shows operation/model/effort breakdowns, cache reuse, avoided calls and estimated cost with historical coverage stated. Diagnostic records include worker and continuation identity, cache TTL split, stop reason and dated pricing. Retention is bounded for newly written records.

Validation: all 38 test files passed (1,264 assertions), including cost/recovery tests. The Trigger.dev 4.5.16 dry-run build passed. Browser checks used local fixture data to verify the Usage dialog, keyboard dismissal and preference persistence. No paid model generations or production deployment were performed. Provider-side quality comparisons and actual savings remain to be measured after rollout.

Deferred experiments remain deferred: company-wide research reuse, overnight provider batches, removing search-result blocks and aggressive reductions to letter/analysis prompts. These need workload or quality evidence. Detailed work remains high effort. Admin generation now defaults to Sol, with Opus and the other configured models available as explicit choices.

---

The best opportunities are to avoid model calls for confirmed factual answers, control reasoning effort explicitly, and reduce the context used for short application answers. Preserve Opus for writing where its quality has already proved useful. Improve usage attribution before choosing a blanket model or cache-policy change.

This is a source audit of all five generators, their shared Anthropic client, Trigger workers, dispatch/recovery paths, public admission, prompt construction, storage and telemetry. No application behavior changed and no paid generation was started. Historical spend could not be read: the available local KV configuration has no usable HTTPS endpoint, and Trigger.dev run-analysis MCP tools are unavailable. This does not establish a production configuration problem. Savings below are opportunities or arithmetic examples, not measured monthly reductions. The external scheduled Gmail workflow mentioned in README is outside this app's recorded model usage.

**Measured prompt sizes**

These are exact JavaScript string lengths and whitespace-separated word counts from the current builders. They exclude job-specific context, user messages and provider-added tool instructions; they are not tokenizer counts.

| Generator | Fixed characters | Fixed words | Model / effort |
| --- | ---: | ---: | --- |
| Fit analysis | 47,403 | 7,666 | Selected model; defaults to Opus / effort omitted |
| Cover letter | 44,397 | 7,316 | Selected model; defaults to Opus / effort omitted |
| Application answer | 37,149 | 6,007 | Selected model; defaults to Opus / effort omitted |
| Screen brief | 11,007 | 1,761 | Selected model; defaults to Opus / high |
| Company research | 560 | 74 | Sonnet / medium |

Public analysis is pinned to Sonnet. The shared full profile alone is 25,941 characters / 4,131 words. Answers additionally send the posting, fit evidence and every earlier completed answer. Briefs already use a smaller profile, although their notes and number of confirmed answers are unbounded.

**1. First priority: cheaper handling of short answers and explicit effort**

Evidence: [answer.js](../lib/answer.js), [analyze.js](../lib/analyze.js), [cover.js](../lib/cover.js), [models.js](../lib/models.js), [anthropic.js](../lib/anthropic.js).

Every answer currently reaches the model, including questions whose entire answer is an already-confirmed fact. Introduce a narrowly defined path for supported question types such as sponsorship and availability, backed by explicit profile facts or approved answers. Preserve the existing refusal behavior when salary, notice period or start date is unknown. Ambiguous or compound questions should use the normal generator. Each safely handled factual question avoids the whole generation and its context cost.

Analysis, letters and answers omit effort; the API defaults to high. Test explicit medium effort for routine answers first, then compare medium against high for analysis and briefs. Keep a quality-sensitive option for letters. Anthropic documents effort as a primary control for reasoning expenditure; it does not reliably control visible response length on Opus 5. [Effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort).

The comment in models.js saying Sonnet 5 does not think unless asked is outdated: adaptive thinking is enabled by default. [Sonnet 5 overview](https://platform.claude.com/docs/en/models/sonnet-5/overview).

For answers still needing generation, compare Sonnet against Opus rather than changing the global default. Current standard input/output prices per million tokens are $2/$10 for Sonnet 5 and $5/$25 for Opus 5: a 60% price reduction at equal token usage. Actual token totals and rewriting rates may differ. [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).

**2. High potential: smaller task-specific context**

Evidence: [profile.js](../lib/profile.js), [writing.js](../lib/writing.js), [answer.js](../lib/answer.js), [cover.js](../lib/cover.js), [brief.js](../lib/brief.js).

A 120-word answer starts with 6,007 words of fixed instructions and profile. Build a compact, maintained candidate fact set plus relevant career evidence for answers. Keep the full profile available for questions requiring broader history. Condense repeated explanations of writing rules while preserving the prominent rules that existing comments identify as important for quality.

For repeated questions on one application, separate the unchanged posting and fit evidence from the current question. Prior-answer context is useful for avoiding repetitive examples, but it grows on every call. Consider a compact record of examples already used, or one generation for a selected group of unanswered questions, only if form volume warrants the extra workflow.

Use deterministic projections first. Adding an extra model call to summarize every input can erase savings. Keep factual support, uncertainty and private/public boundaries intact. Test context reduction independently from model and effort changes so regressions can be attributed.

**3. Medium potential: make caching match actual usage**

Evidence: [anthropic.js:70](../lib/anthropic.js), the three large prompt builders, and [usage.js](../lib/usage.js).

The client already caches the stable system block, using the default five-minute lifetime. Each generator has a different opening and layout, so their shared profile is not a reusable common prefix across analysis, letters and answers. A consistent opening containing shared rules and profile, with an explicit breakpoint, could enable reuse when the model and preceding configuration match. Preserve the placement of important instructions and evaluate quality after reordering.

For multiple answers on one job, add a breakpoint after unchanged job context; place growing answer history and the current question later. Currently all of that context lives in an uncached volatile block.

For these models, warm cache reads cost 10% of ordinary input. Five-minute writes cost 1.25 times input; one-hour writes cost twice input. Longer caching can help with gaps of 5–60 minutes, but is worse for isolated requests and unnecessary for already-warm bursts. Choose TTL from observed reuse and cache-read/write counts. The cache lifetime starts at request start, so long generations consume part of the window. [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

Prioritize reasoning before tiny savings on already-cached input: on Opus, 10,000 cache-read tokens cost $0.005, while 2,000 output tokens cost $0.05. These are illustrative token charges, excluding other usage. [Pricing](https://platform.claude.com/docs/en/about-claude/pricing).

**4. Confirmed avoidable-work issues**

Evidence: [anthropic.js:103](../lib/anthropic.js), [cover.js:169](../lib/cover.js), [task-policy.js](../lib/task-policy.js), [generation-fingerprint.js](../lib/generation-fingerprint.js), [api/admin/jobs.js:117](../api/admin/jobs.js).

- Every non-success provider response becomes status 502. A mocked provider 400 was therefore marked retryable. Preserve upstream status and distinguish permanent request/authentication errors from transient rate limits and service failures. This primarily avoids compute and failed attempts; rejected requests should not be counted as confirmed token waste.
- A cover generation can make two parse attempts inside each of three task attempts: up to six paid generations if failures exhaust both layers. Keep recovery, but track attempts and prevent repeated full regeneration after deterministic truncation or validation failures. Structured output is a compatibility experiment, not an automatic reason to remove existing salvage behavior.
- A research generation permits five continuations after its initial request. A local mock confirmed six requests before the cap. With three task attempts, the failure path can reach eighteen requests. The configured eight searches are a per-request tool limit; this client does not enforce a cumulative operation budget. Track total usage across continuations and retries, then tune limits against real completion rates.
- Brief fingerprints include complete question objects and full report/research objects. A mock changing only a question's run status changed the fingerprint while leaving brief model input identical. Hash the semantic input projection and generation policy instead. Also avoid invalidating research or briefs when a PATCH supplies an unchanged value. These changes reduce unnecessary staleness or supersession without withholding requested rewrites.

Admin idempotency is keyed by request ID. Different browser requests for the same ongoing work can still overlap; an atomic claim on equivalent in-flight work would prevent this. The UI already disables buttons, reuses fresh briefs and deliberately offers rewrites, so treat this as backend hardening rather than evidence of frequent duplicate spend. Preserve explicit rewrite intent.

**5. Research and bulk work: defer until volume warrants it**

Evidence: [research.js](../lib/research.js), [screen-work.js](../lib/screen-work.js), [screen-artifacts.js](../lib/screen-artifacts.js), [analyse-all.ts](../src/trigger/analyse-all.ts).

Research already uses Sonnet at medium effort and reuses results for seven days within the same job. If several roles target one company, share company facts by normalized company/domain and keep role-specific analysis separate; the present research includes role context and cannot safely be reused wholesale across roles.

The chosen web-search tool already supports dynamic filtering by default. Its response inclusion defaults to full; testing `response_inclusion: "excluded"` may reduce output costs, but normalization currently uses search-result blocks to build source mappings. Verify citation equivalence, error handling and paused-turn replay before adopting it. [Web search documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool).

Analyse all uses Trigger's batch orchestration while each child calls the ordinary Messages endpoint. It does not receive Anthropic's Message Batches discount. An optional overnight queue could receive the provider's 50% input/output discount, trading immediacy for lower cost. It reduces price, not necessarily token count. [Batch pricing](https://platform.claude.com/docs/en/about-claude/pricing).

**6. Measurement needed before a savings target**

[usage.js](../lib/usage.js) already records input, output, cache reads/writes, searches, model, effort, latency and request reference. Keep it. However, daily rollups merge models and operation types; omitted effort is stored as blank; the exposed usage endpoint returns only daily totals. The per-reference history is capped at 50 calls, but there is no corresponding retention policy for all reference keys.

Extend the existing telemetry with daily model/kind splits, effective effort, provider status/stop reason, task attempt, continuation number and estimated cost using dated prices. Preserve cache-write TTL distinctions if one-hour caching is added. Surface token cost per completed artifact, cache reuse, retries and regeneration frequency. Include output reasoning where the provider exposes it, rather than inferring it from the length of visible prose.

The public endpoint already limits posting length, per-IP traffic and daily admitted generations, with a kill switch. These are useful controls, but 60 accepted jobs does not mean 60 API attempts or a fixed dollar ceiling. If required, add a monetary budget using reservations that account for retries and actual usage.

**What is already economical**

Completed analyses reuse results by posting, model and generation context. Retries recover persisted artifacts. Public concurrent duplicates share admission. Private report metadata is projected out of downstream prompts. Ingestion, adoption and posting extraction use ordinary code. Tasks have duration limits, modest concurrency and no explicit oversized machines or repository-defined crons. Parent tasks use Trigger waits and batch orchestration; smaller machines are a lower-priority experiment requiring actual memory/duration data. Trigger run auditing can be enabled with `npx trigger.dev@latest install-mcp`; installation was not performed during this review.

Do not simply lower every `max_tokens` value: an unused ceiling is not billed usage, and truncating a response can trigger another paid generation. Existing comments document prior truncation failures.

**Validation and recommended sequence**

Six existing test files passed: anthropic (44), usage (28), prompts (21), screen (23), release-d (25), release-e (35): 176 assertions total. They ran directly after the aggregate runner could not start its child process in this environment. Separate in-memory probes confirmed prompt sizes, the provider-error classification, the continuation cap and metadata-only fingerprint changes. These checks verify source behavior; they do not measure writing quality or production savings.

Implement telemetry and avoidable-work fixes first. Next trial factual answers and lower effort on a fixed set of representative questions. Then compare compact prompts, cache layouts and selective Sonnet routing, changing one variable at a time. Judge factual correctness, voice, honest gaps, length compliance, citation integrity and cost per usable result. Preserve high-quality letters unless a cheaper variant passes that comparison.
