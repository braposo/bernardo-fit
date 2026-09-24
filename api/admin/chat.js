import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { tasks, runs, streams, idempotencyKeys } from '@trigger.dev/sdk';
import { requireAdmin } from '../../lib/admin.js';
import { jevEnabled } from '../../lib/jev.js';
import { chatModels } from '../../lib/chat/models.js';
import { validateChatRequest, chatError } from '../../lib/chat/policy.js';
import { getRunReceipt, getReceiptForRequest, saveRunReceipt } from '../../lib/run-receipts.js';
import { hasKV } from '../../lib/kv.js';

const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELED', 'CRASHED', 'SYSTEM_FAILURE', 'EXPIRED', 'TIMED_OUT']);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createChatHandler({ env = process.env, storage = hasKV, trigger = tasks.trigger,
  retrieve = runs.retrieve, cancel = runs.cancel, read = streams.read, key = idempotencyKeys.create,
  receiptForRun = getRunReceipt, receiptForRequest = getReceiptForRequest, saveReceipt = saveRunReceipt } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!requireAdmin(req, res)) return;
    try {
      const workerReady = env.ADMIN_CHAT_WORKER_READY === '1' && !!env.TRIGGER_SECRET_KEY && storage &&
        (env.VERCEL_ENV !== 'preview' || (!!env.TRIGGER_PREVIEW_BRANCH && env.TRIGGER_SECRET_KEY.startsWith('tr_preview_')));
      if (req.method === 'GET' && !req.query?.run) return res.status(200).json({
        models: chatModels(env), autoAvailable: jevEnabled(env), enabled: env.ADMIN_CHAT_ENABLED === '1',
        insightsEnabled: env.ADMIN_CHAT_INSIGHTS_ENABLED === '1',
        contextConfigured: !!env.SANITY_CONTEXT_MCP_URL && !!env.SANITY_ORGANIZATION_TOKEN,
        workerConfigured: workerReady, transport: 'trigger',
      });
      if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
      // Existing runs remain readable/cancellable when new submissions are disabled.
      const runId = req.query?.run || req.body?.runId;
      if (runId) {
        const receipt = await receiptForRun(String(runId));
        if (receipt?.kind !== 'admin-chat') return res.status(404).json({ error: 'Chat request not found.' });
        if (req.method === 'POST') {
          if (req.body.action !== 'stop') throw chatError('Unknown action.');
          await cancel(receipt.runId);
          return res.status(202).json({ stopping: true });
        }
        return await relayChatRun(req, res, receipt.runId, { retrieve, read });
      }
      if (env.ADMIN_CHAT_ENABLED !== '1') throw chatError('Chat is not enabled yet.', 503, 'CHAT_DISABLED');
      if (!workerReady) throw chatError('Chat processing is unavailable.', 503, 'CHAT_WORKER_UNAVAILABLE');
      const requestId = req.body?.requestId;
      if (!uuid(requestId)) throw chatError('Request ID must be a UUID.');
      const request = validateChatRequest({ ...req.body, provider: 'auto', model: 'auto' });
      request.conversationId ||= requestId;
      const fingerprint = digest(request);
      const prior = await receiptForRequest('admin-chat', request.conversationId, requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw chatError('This request ID belongs to another question.', 409);
        return res.status(202).json({ runId: prior.runId, requestId, recovered: true });
      }
      const idempotencyKey = await key(`admin-chat:${requestId}`, { scope: 'global' });
      const handle = await trigger('admin-context-chat', { requestId, request }, {
        idempotencyKey, idempotencyKeyTTL: '30d', ttl: '5m', maxAttempts: 1,
        metadata: { phase: 'queued' }, tags: [`request:${requestId}`],
      });
      // Validate the accepted payload even after an ambiguous dispatch or concurrent retry.
      const accepted = await retrieve(handle.id);
      if (accepted.taskIdentifier !== 'admin-context-chat' || digest(accepted.payload?.request) !== fingerprint)
        throw chatError('This request ID belongs to another question.', 409);
      await saveReceipt({ kind: 'admin-chat', jobId: request.conversationId, requestId, runId: handle.id, fingerprint });
      return res.status(202).json({ runId: handle.id, requestId, recovered: false });
    } catch (error) {
      if (res.headersSent) { if (!res.writableEnded) res.end(); return; }
      const safe = error.code?.startsWith('CHAT_');
      return res.status(safe ? error.status : 503).json({ error: safe ? error.message : 'Chat is temporarily unavailable. Please retry.', code: safe ? error.code : 'CHAT_UNAVAILABLE' });
    }
  };
}

// This connection only observes a durable run. Closing it never cancels generation.
export async function relayChatRun(req, res, runId, { retrieve, read }) {
  const startIndex = Number(req.query?.cursor || 0);
  if (!Number.isSafeInteger(startIndex) || startIndex < 0 || startIndex > 1000000) throw chatError('Invalid stream cursor.');
  const abort = new AbortController();
  const disconnect = () => abort.abort();
  res.on('close', disconnect); req.on('aborted', disconnect);
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(45000)]);
  let started = false;
  const send = async (event, data) => {
    signal.throwIfAborted();
    if (!started) {
      res.statusCode = 200; res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders?.(); started = true;
    }
    if (!res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) await once(res, 'drain', { signal });
  };
  const finish = async run => {
    if (!terminal.has(run.status)) return false;
    const snapshot = run.status === 'COMPLETED' && run.output ? run.output : {
      status: run.status === 'CANCELED' ? 'stopped' : 'failed',
      error: run.status === 'CANCELED' ? '' : 'Chat could not complete the response. Please retry.',
    };
    await send('snapshot', snapshot);
    await send('done', { status: snapshot.status, truncated: snapshot.status === 'truncated' });
    return true;
  };
  try {
    const run = await retrieve(runId);
    if (await finish(run)) return;
    await send('activity', { state: run.metadata?.phase || 'queued' });
    const stream = await read(runId, 'chat', { startIndex, timeoutInSeconds: 20, signal });
    for await (const part of stream) {
      if (!['text', 'route', 'activity', 'sources', 'snapshot', 'done'].includes(part.event)) continue;
      await send(part.event, { ...part.data, seq: part.seq });
      if (part.event === 'done') return;
    }
    await finish(await retrieve(runId));
  } catch {
    // Reconnect to the same run on timeout, network interruption or a not-yet-created stream.
    // Never manufacture a generation failure from a failed subscription.
  } finally {
    abort.abort(); res.off('close', disconnect); req.off('aborted', disconnect);
    if (!res.writableEnded && !res.destroyed) res.end();
  }
}

export default createChatHandler();
