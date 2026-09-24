import { createClient } from '@sanity/client';
import { scheduledEventHandler } from '@sanity/functions';
import { loadChatSettings } from './settings.js';
import { classifyWithJev, classifyPending } from './classifier.js';

export const handler = scheduledEventHandler(async () => {
  const { SANITY_CONTEXT_WRITE_TOKEN, TYPESAFE_API_KEY } = process.env;
  if (!SANITY_CONTEXT_WRITE_TOKEN || !TYPESAFE_API_KEY) throw new Error('Insights credentials are missing');
  const client = createClient({ apiVersion: 'v2025-11-27', token: SANITY_CONTEXT_WRITE_TOKEN,
    context: { organizationId: 'o1hiishuc' }, useCdn: false, useProjectHostname: false,
    timeout: 15000, maxRetries: 0 });
  const settings = await loadChatSettings();
  const result = await classifyPending(client, messages => classifyWithJev(messages, {settings}));
  console.log(JSON.stringify({ settingsRevision:settings.revision, classified: result.successCount, failed: result.errorCount, found: result.totalFound }));
});
