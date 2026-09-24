export async function readChatStream(response, onEvent) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || `Chat request failed (${response.status}).`), { status: response.status });
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Chat returned an unexpected response.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', finished = false;
  const parse = block => {
    let event = 'message'; const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    const value = JSON.parse(data.join('\n'));
    if (event === 'error') throw new Error(value.error || 'The response was interrupted.');
    onEvent(event, value);
    if (event === 'done') finished = true;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        parse(buffer.slice(0, match.index)); buffer = buffer.slice(match.index + match[0].length);
      }
      if (buffer.length > 200000) throw new Error('Chat response is too large.');
      if (done) break;
    }
    if (buffer.trim()) parse(buffer);
    if (!finished) throw new Error('The connection ended before the response completed.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function historyForTurns(turns, question) {
  const messages = turns.flatMap(turn => turn.status === 'complete' ? [
    { role: 'user', content: turn.question }, { role: 'assistant', content: turn.text },
  ] : []);
  messages.push({ role: 'user', content: question });
  if (messages.length > 40 || messages.some(m => !m.content.trim() || m.content.length > 12000) ||
      new TextEncoder().encode(messages.map(m => m.content).join('')).length > 48000)
    throw new Error('This conversation has reached its limit. Start a new chat to continue.');
  return messages;
}
