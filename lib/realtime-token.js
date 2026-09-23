import { auth } from '@trigger.dev/sdk';

// Bind credentials to one authorized run and exclude private task inputs/results.
export async function realtimeCredentials(runId) {
  return { runId, publicAccessToken: await auth.createPublicToken({
    scopes: { read: { runs: [runId] } }, expirationTime: '1h',
    realtime: { skipColumns: ['payload', 'output', 'error'] },
  }) };
}
