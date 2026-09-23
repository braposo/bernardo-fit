import { createClient } from '@sanity/client';
import { scheduledEventHandler } from '@sanity/functions';
import { classifyPending } from './classifier.js';

export const handler = scheduledEventHandler(async () => {
  const { SANITY_CONTEXT_WRITE_TOKEN, TYPESAFE_API_KEY } = process.env;
  if (!SANITY_CONTEXT_WRITE_TOKEN || !TYPESAFE_API_KEY) throw new Error('Insights credentials are missing');
  const client = createClient({ apiVersion: 'v2025-11-27', token: SANITY_CONTEXT_WRITE_TOKEN,
    context: { organizationId: 'o1hiishuc' }, useCdn: false, useProjectHostname: false,
    timeout: 15000, maxRetries: 0 });
  const result = await classifyPending(client);
  console.log(JSON.stringify({ classified: result.successCount, failed: result.errorCount, found: result.totalFound }));
});
