import { readChatStream } from './stream';

const pause = signal => new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 2000);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
});

// Reconnect only to this submission's idempotency key/run. Never regenerate on network failure.
export async function followChatRequest({ request, runId, cursor = 0, headers, signal, onRun, onEvent, onReconnect }) {
  while (!signal.aborted) {
    try {
      if (!runId) {
        const response = await fetch('/api/admin/chat', { method: 'POST', headers: headers(), signal, body: JSON.stringify(request) });
        const body = await response.json();
        if (!response.ok) throw Object.assign(new Error(body.error || 'Chat could not start.'), { status: response.status, definitive: ['CHAT_DISABLED', 'CHAT_WORKER_UNAVAILABLE'].includes(body.code) });
        if (typeof body.runId !== 'string') throw Error('Missing run ID');
        runId = body.runId; onRun(runId);
      }
      const response = await fetch(`/api/admin/chat?run=${encodeURIComponent(runId)}&cursor=${cursor}`, { headers: headers(), signal });
      await readChatStream(response, (event, data) => {
        if (Number.isSafeInteger(data.seq)) {
          if (data.seq < cursor) return;
          cursor = data.seq + 1;
        }
        onEvent(event, data);
      });
      return;
    } catch (error) {
      if (signal.aborted) throw error;
      if (error.definitive || [400, 401, 403, 404, 409, 429].includes(error.status)) throw error;
      onReconnect();
      await pause(signal);
    }
  }
  signal.throwIfAborted();
}
