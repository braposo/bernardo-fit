import { task, streams, metadata, AbortTaskRunError } from '@trigger.dev/sdk';
import { registerTelemetry } from 'ai';
import { OpenTelemetry } from '@ai-sdk/otel';
import { loadChatSettings } from '../../lib/chat/settings.js';
import { chatPromptSpanAttributes } from '../../lib/prompt-telemetry.js';
import { executeChatWork } from '../../lib/chat/work.js';
import { hasKV } from '../../lib/kv.js';

// This chat uses a regular task rather than chat.agent(), so AI SDK 7 needs
// its OpenTelemetry adapter registered in the worker process.
registerTelemetry(new OpenTelemetry({ enrichSpan: chatPromptSpanAttributes }));

export const adminChat = task({
  id: 'admin-context-chat',
  maxDuration: 210,
  retry: { maxAttempts: 1 }, // Never replay a partially billed answer automatically.
  queue: { concurrencyLimit: 2 },
  run: async (payload: { requestId?: string; request?: any; healthcheck?: boolean }, { signal }) => {
    // Operational probe, available through authenticated Trigger tooling only.
    // The app dispatcher never copies this flag from user input.
    if (payload.healthcheck === true) {
      const settings = await loadChatSettings();
      const checks = { storage: hasKV, context: !!process.env.SANITY_CONTEXT_MCP_URL && !!process.env.SANITY_ORGANIZATION_TOKEN,
        jev: !!process.env.TYPESAFE_API_KEY, openai: !!process.env.OPENAI_API_KEY, anthropic: !!process.env.ANTHROPIC_API_KEY,
        insights: process.env.ADMIN_CHAT_INSIGHTS_ENABLED === '1' && !!process.env.SANITY_CONTEXT_WRITE_TOKEN };
      return { ready: Object.values(checks).every(Boolean), checks, settingsRevision:settings.revision };
    }
    if (!hasKV) throw new AbortTaskRunError('Chat storage is unavailable.');
    let result: any, seq = 0;
    const { waitUntilComplete } = streams.writer('chat', {
      execute: async ({ write }) => {
        result = await executeChatWork(payload, { signal, emit: async (event: string, data: any) => {
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
