# Shared application-copy rollout

The September 2026 editorial update changes reusable candidate context, prompts and presentation. It does not regenerate or edit saved job-specific fit reports, letters, application answers or their active-version references.

## Source ownership

| Source | Editing location | Runtime use |
| --- | --- | --- |
| Candidate facts and preferences | Sanity Candidate profile and linked Candidate evidence | Loaded for each generation snapshot. Keep the profile summary short and detailed evidence in its referenced documents. |
| Motivation and interview context | Candidate profile specialised summaries | Overrides the corresponding baseline entries in Analysis settings. Keep repeated facts aligned. |
| Writing rules and output shape | Analysis settings, `texts[]` by key | Shared prose rules plus fit, cover, answer and brief instructions. |
| Practical-fit rules | Analysis settings, `questions[]` | Distinguish employer requirements from imported labels, and preferences from hard constraints. |
| Public identity and master CV | Site page / CV, slug `cv` | Public contact details, CV sections, shared letter header and PDF asset. |
| Public introduction | Site page / CV, slug `home` | Homepage copy; the app template controls layout. |

`sourcePayload`, migration snapshots and code-baseline fixtures are historical recovery or compatibility data, not the editing surface for current connected generation. Writing guidance documents are not consumed automatically. Do not seed over edited Analysis settings.

## Release sequence

Candidate facts, specialised summaries, chat context and the master CV/PDF have been updated in Sanity with backups and revision guards. The revised Analysis settings are staged as `drafts.fit-analysis-settings`. They must remain a draft until the matching code is released: older cover code forces a gap and appends promotional copy, and the old fit renderer shows an empty extra-section heading.

1. Merge the application PR only after explicit user approval and passing CI, as required by AGENTS.md.
2. Release the Vercel application and its matching hosted Trigger Production worker. Follow the existing worker-version requirements, including the exact application Git SHA for a manual Production deployment. Do not point production to a local worker.
3. Recheck the settings draft against the published document and the saved editorial snapshot. Resolve any intervening Studio edits before publishing the draft. Validate it with `settingsFromDocument` and confirm `loadAnalysisSettings` composes the expected candidate context.
4. Verify the production public CV/download and token-protected document readers. Use fixtures or an explicitly authorised non-publishing generation check for copy validation. Ordinary generation endpoints save and can activate new versions.
5. The user can then regenerate selected application materials. Existing versions and scores remain as saved; candidate changes can make earlier assessments stale.

## Editorial contract

- Lead with relevant management responsibilities, delivered work and technical decisions. Describe personal and team contributions accurately.
- The proposed SingleStore Next.js/Sanity migration was a plan only and had not started on departure. Never present it as implemented, underway or a delivered saving.
- Preserve the user's prohibition on public direct-report, hiring and promotion counts. Use specific work without implying management of managers or inflated organisational responsibility.
- The master CV stays on one A4 page. The export workflow and source/PDF checks are documented in [sanity-public-pages.md](sanity-public-pages.md).
- The CV header contains identity, home location and contact links. Leave out eligibility, sponsorship, availability and London travel details, keeping the freed space empty. Retain these facts in private candidate context for relevant application questions.
- Default cover letters target 180-250 words in 3-4 paragraphs. Gaps, AI discussion and fit-link copy are conditional. The existing 430-word ceiling is a prompt/layout budget, not a truncation step.
- Fit reports use 3-4 relevant evidence sections and 0-2 additional differentiators. Keep existing JSON field names and support historical reports with more sections.
- Harrogate residence, UK eligibility and recorded London travel flexibility must remain distinct. Do not infer London residency, a fixed multi-day commute or a remote-only requirement.

The editable Sanity draft contains the full prompts. This document records source ownership and rollout dependencies, not a second executable prompt source.
