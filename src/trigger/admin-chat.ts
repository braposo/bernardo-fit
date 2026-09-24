import { task, streams, metadata, logger, AbortTaskRunError } from '@trigger.dev/sdk';
import { executeChatWork } from '../../lib/chat/work.js';
import { hasKV } from '../../lib/kv.js';

export const adminChat = task({
  id: 'admin-context-chat',
  maxDuration: 210,
  retry: { maxAttempts: 1 }, // Never replay a partially billed answer automatically.
  queue: { concurrencyLimit: 2 },
  run: async (payload: { requestId?: string; request?: any; healthcheck?: boolean }, { signal }) => {
    // Operational probe, available through authenticated Trigger tooling only.
    // The app dispatcher never copies this flag from user input.
    if (payload.healthcheck === true) {
      const checks = { storage: hasKV, context: !!process.env.SANITY_CONTEXT_MCP_URL && !!process.env.SANITY_ORGANIZATION_TOKEN,
        jev: !!process.env.TYPESAFE_API_KEY, openai: !!process.env.OPENAI_API_KEY, anthropic: !!process.env.ANTHROPIC_API_KEY,
        insights: process.env.ADMIN_CHAT_INSIGHTS_ENABLED === '1' && !!process.env.SANITY_CONTEXT_WRITE_TOKEN };
      return { ready: Object.values(checks).every(Boolean), checks };
    }
    if (!hasKV) throw new AbortTaskRunError('Chat storage is unavailable.');
    let result: any, seq = 0;
    const { waitUntilComplete } = streams.writer('chat', {
      execute: async ({ write }) => {
        result = await executeChatWork(payload, { signal, onRoute: route => {
          const decision = { model: route.model, provider: route.provider, source: route.source,
            jevChoice: route.jevChoice, confidence: Number.isFinite(route.confidence) ? route.confidence : null,
            probability: Number.isFinite(route.probability) ? route.probability : null,
            fallbackUsed: route.fallbackUsed === true, policy: route.policy };
          logger.info(`Jev model selection: ${route.provider}/${route.model}`, { requestId: payload.requestId, ...decision });
          metadata.set('modelSelection', decision);
        }, emit: async (event: string, data: any) => {
          if (event === 'activity') metadata.set('phase', data.state);
          if (event === 'text') metadata.set('phase', 'writing');
          if (event === 'done') metadata.set('phase', data.status);
          write({ seq: seq++, event, data });
        } });
      },
    });
    await waitUntilComplete();
    return result;
  },
});
