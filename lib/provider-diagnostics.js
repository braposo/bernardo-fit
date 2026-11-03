// Keep only bounded provider error fields and diagnostic headers, never raw
// response bodies, request payloads, or authentication headers.
const HEADERS = [
  'x-request-id', 'request-id', 'retry-after', 'retry-after-ms',
  'openai-organization', 'openai-project', 'openai-processing-ms',
  'x-ratelimit-limit-requests', 'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-requests', 'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens',
];
const MAX_ERROR_BYTES = 16 * 1024;

function safeText(value, credential, limit = 500) {
  if (typeof value !== 'string') return undefined;
  return (credential ? value.replaceAll(credential, '[redacted]') : value)
    .replace(/\b(?:sk-|sk_)[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) || undefined;
}

async function errorBody(response) {
  if (!response.body) return {bodyRead: 'empty'};
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_ERROR_BYTES) return {bodyRead: 'too_large'};
      chunks.push(Buffer.from(value));
    }
    if (!bytes) return {bodyRead: 'empty'};
    try {return {bodyRead: 'json', body: JSON.parse(Buffer.concat(chunks).toString('utf8'))};}
    catch {return {bodyRead: 'non_json'};}
  } catch {return {bodyRead: 'unreadable'};}
  finally {
    // retry.fetch clones error responses. Awaiting cancellation can block on
    // its unread clone. Body consumption is bounded by the worker maxDuration.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function providerDiagnostics(response, {provider, credential}) {
  const headers = {};
  for (const name of HEADERS) {
    const value = safeText(response.headers?.get(name), credential, 200);
    if (value) headers[name] = value;
  }
  const {bodyRead, body} = await errorBody(response);
  const error = body?.error;
  const details = {provider, status: response.status, headers, bodyRead};
  for (const field of ['code', 'type', 'message', 'param']) {
    const value = safeText(error?.[field], credential, field === 'message' ? 500 : 160);
    if (value) details[field] = value;
  }
  return details;
}
