import { createClient } from '@sanity/client';

export function classificationClient(env = process.env) {
  if (!env.SANITY_CONTEXT_WRITE_TOKEN?.trim()) throw new Error('Insights credentials are missing');
  return createClient({ apiVersion: 'v2025-11-27', token: env.SANITY_CONTEXT_WRITE_TOKEN.trim(),
    context: { organizationId: 'o1hiishuc' }, useCdn: false, useProjectHostname: false,
    timeout: 15000, maxRetries: 0 });
}
