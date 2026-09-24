import { loadChatSettings } from './settings.js';
import { connectContext } from './context.js';
import { selectChatModel } from './models.js';
import { createChatAgent } from './agent.js';
import { admitChat } from './admission.js';
import { validateChatRequest } from './policy.js';
import { insightsClient, saveChatTurn } from './insights.js';

// One paid attempt per task. Transport reconnects never re-enter this function.
export function createChatWork({ connect = connectContext, select = selectChatModel,
  makeAgent = createChatAgent, admit = admitChat, saveTurn = saveChatTurn, loadSettings = loadChatSettings, env = process.env } = {}) {
  return async function execute({ request: input, requestId: ref }, { signal: cancellation, emit = async () => {}, onRoute = () => {} } = {}) {
    const signal = AbortSignal.any([...(cancellation ? [cancellation] : []), AbortSignal.timeout(180000)]);
    const request = validateChatRequest(input);
    const result = { text: '', sources: [], status: 'failed' };
    let context, release, route;
    const phase = state => emit('activity', { state });
    try {
      if (env.ADMIN_CHAT_INSIGHTS_ENABLED === '1') insightsClient(env);
      release = await admit(ref);
      await phase('connecting');
      const settings = await loadSettings({env,signal});
      context = await connect({ signal, env });
      await phase('routing');
      route = await select({ ...request, provider: 'auto', model: 'auto' }, { env, ref, signal, settings });
      await onRoute(route);
      await emit('route', { requestId: ref });
      const response = await makeAgent({ route, context, ref, settings }).stream({ messages: request.messages, abortSignal: signal });
      let finish;
      for await (const part of response.stream) {
        signal.throwIfAborted();
        if (part.type === 'error' || part.type === 'abort') throw Error('Generation interrupted');
        if (part.type === 'text-delta') {
          if (result.text.length + part.text.length > 100000) throw Error('Response too long');
          result.text += part.text; await emit('text', { text: part.text });
        }
        if (part.type === 'tool-call') await phase('reading');
        if (part.type === 'tool-error') await phase('query-failed');
        if (part.type === 'tool-result') {
          result.sources = [...context.sources.values()]; await emit('sources', { sources: result.sources });
        }
        if (part.type === 'finish') {
          if (['error', 'content-filter', 'other', 'tool-calls'].includes(part.finishReason)) throw Error('No final answer');
          finish = part.finishReason;
        }
      }
      if (!finish || !result.text.trim()) throw Error('Incomplete stream');
      result.status = finish === 'length' ? 'truncated' : 'complete';
    } catch (error) {
      result.status = cancellation?.aborted ? 'stopped' : 'failed';
      result.error = cancellation?.aborted ? '' : signal.aborted ? 'The response timed out. Try a shorter question.' :
        (error.code === 'CHAT_RATE_LIMIT' || error.code?.startsWith('CHAT_SETTINGS_')) ? error.message : 'Chat could not complete the response. Please retry.';
    } finally {
      if (release && env.ADMIN_CHAT_INSIGHTS_ENABLED === '1') {
        try {
          await phase('saving');
          await saveTurn({ request, ref, route, text: result.text, outcome: result.status, env });
          result.storage = 'saved';
        } catch { result.storage = 'failed'; }
      }
      await context?.close().catch(() => {});
      await release?.().catch(() => {});
    }
    await emit('snapshot', result);
    await emit('done', { status: result.status, truncated: result.status === 'truncated' });
    return result;
  };
}

export const executeChatWork = createChatWork();
