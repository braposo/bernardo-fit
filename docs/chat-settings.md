# Editable chat configuration

Open [Fit Studio](https://job-fit-app.sanity.studio/) → **Chat settings**. Changes become active after **Publish**, on the next chat request or Insights classification batch. Drafts never affect the app. A running response keeps its original snapshot.

- **Assistant:** assistant and Context instructions, policy label, maximum response tokens per step, maximum agent steps.
- **Models & routing:** Jev API model, routing instructions, confidence/probability thresholds, OpenAI/Anthropic model IDs, labels, routing descriptions, enabled flags, and fallback priorities. Lower fallback priorities win when Jev is uncertain; equal priorities use list order. Credentials must exist for the selected provider. Model IDs must be valid for the provider account; syntax validation cannot verify account access.
- **Insights:** Jev classifier model, success rubric, sentiment descriptions, content-gap questions and labels, and gap probability threshold. Success retains ten score labels and sentiment retains the three values required by Sanity's classification API.

The published singleton is `chatSettings` / `fit-chat-settings` in project `quli96gc`, dataset `production`. It is fetched without CDN caching, validated, copied and deeply frozen once per turn. Missing or invalid settings stop the request before Context/AI calls. There is no silent runtime fallback to code defaults. `lib/chat/settings-defaults.js` exists only as a seed and test fixture. The non-chat analysis instructions continue to use the existing **Analysis settings** singleton.

Trigger's `modelSelection` log/metadata records the selected model, Jev model, policy, Sanity revision and configuration fingerprint. Saved Insights turns retain the revision/fingerprint. The classifier logs the revision for each batch. The browser receives neither prompts nor the model catalog; its capabilities response reports provider availability only.

Credentials, API endpoints, admin authentication, document/tool access restrictions, input/output safety bounds, transport timeouts, concurrency and paid-retry protections remain in code/environment settings. Changing prompts cannot grant tools additional access. `SANITY_READ_TOKEN` is required by the chat Development worker and the existing Sanity classifier; the launcher copies only allowlisted credentials to its ignored worker environment file.

## Studio schema and initial setup

The canonical Studio schema is `lib/sanity/studio/chatSettings.ts`. It is installed as `studio-fit-app/schemaTypes/chatSettings.ts` and exported from that Studio's schema index. Its desk structure adds:

```ts
S.listItem().title('Chat settings').id('chat-settings')
  .child(S.document().schemaType('chatSettings').documentId('fit-chat-settings'))
```

Exclude `chatSettings` from generated document lists and creation templates, and disable delete/duplicate/unpublish actions, as for `analysisSettings`. The sibling Studio has no configured Git remote; the canonical schema is tracked in the app PR and the Studio wiring is committed locally.

Seed the existing configuration once with `node --env-file=.env.local scripts/seed-chat-settings.mjs`. It validates the fixture and uses `createIfNotExists`; it never overwrites existing published edits or drafts. Revert an unwanted edit through Studio history and publish it again.

The runtime loader lives inside `functions/classify-conversations/settings.js` so the Sanity Function bundle includes the same validation used by the chat worker; `lib/chat/settings.js` re-exports it. The hourly classifier loads once before processing its batch, so a temporary settings failure leaves conversations pending for the next scheduled run.

Trigger remains **Development**, branch `codex/sanity-context-chat-setup`. Keep `npm run trigger:dev:chat` running on this computer. Publishing settings requires no app/worker redeploy. Studio/schema or runtime code changes still require deployment.

## Verification

`tests/test-chat-settings.mjs` covers published-only loading, rejected invalid configuration, immutable per-turn snapshots, edited routing criteria/thresholds/model IDs, actual SDK prompt/token configuration, and classifier configuration. Existing admin-chat, durable-chat and Jev tests cover the surrounding flow. Live verification uses a no-generation Development health check which fetches the published revision; no private conversation or paid provider request is required.
