import { task, streams, metadata, AbortTaskRunError } from '@trigger.dev/sdk';
import { executeChatWork } from '../../lib/chat/work.js';
import { hasKV } from '../../lib/kv.js';

export const adminChat = task({
  id: 'admin-context-chat',
  maxDuration: 210,
  retry: { maxAttempts: 1 }, // Never replay a partially billed answer automatically.
  queue: { concurrencyLimit: 2 },
  run: async (payload: { requestId: string; request: any }, { signal }) => {
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
