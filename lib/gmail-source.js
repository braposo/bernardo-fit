// Read-only Gmail access for the daily status check (docs/gmail-status-check.md).
// OAuth2 refresh-token flow for one personal mailbox, then the Gmail REST API.
// Credentials are read here, inside the worker, and never travel in a task
// payload. URLs are built in code from validated IDs, never taken from a payload.
import { AbortTaskRunError, retry } from '@trigger.dev/sdk';
import { discardResponseBody } from './http-response.js';
import { retryAfterDate } from './linkedin-request.js';

export const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const BODY_EXCERPT_MAX = 4000;
const REQUEST_TIMEOUT_MS = 30_000;
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RETRYABLE = [408, 429, 500, 502, 503, 504];

export function gmailCredentials(env = process.env) {
  const clientId = env.GMAIL_CLIENT_ID?.trim(), clientSecret = env.GMAIL_CLIENT_SECRET?.trim(), refreshToken = env.GMAIL_REFRESH_TOKEN?.trim();
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}
export const gmailEnabled = (env = process.env) => !!gmailCredentials(env);

// The child task's catchError: Trigger owns retries and delays.
export function gmailRetryPolicy({ error }) {
  if (error?.name === 'AbortTaskRunError') return { skipRetrying: true };
  return error?.retryAt ? { retryAt: error.retryAt } : undefined;
}

const plainFetch = options => ({ ...options, timeoutInMs: REQUEST_TIMEOUT_MS,
  retry: { byStatus: {}, timeout: { maxAttempts: 1 }, connectionError: { maxAttempts: 1 } } });

function httpFailure(label, response) {
  const message = `${label} HTTP ${response.status}`;
  const retryAt = retryAfterDate(response.headers.get('retry-after'));
  discardResponseBody(response);
  if (RETRYABLE.includes(response.status)) return Object.assign(new Error(message), { retryAt });
  return new AbortTaskRunError(message);
}

// An access token lasts about an hour; one worker process reuses it across the
// day's requests instead of refreshing for each one.
let cachedToken = null;
export function resetGmailTokenForTests() { cachedToken = null; }

export async function gmailAccessToken({ signal, env = process.env, fetchRequest = retry.fetch, now = Date.now() } = {}) {
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) return cachedToken.token;
  const credentials = gmailCredentials(env);
  if (!credentials) throw new AbortTaskRunError('Configure GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN in Trigger.dev.');
  const response = await fetchRequest(GMAIL_TOKEN_URL, plainFetch({
    method: 'POST', redirect: 'error', signal,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken, grant_type: 'refresh_token' }).toString(),
  }));
  // 400/401 mean the refresh token was revoked or expired: a person must renew it.
  if (!response.ok) throw httpFailure('Gmail token refresh', response);
  let body;
  try { body = await response.json(); } catch { throw new AbortTaskRunError('Gmail token response is not JSON'); }
  if (typeof body?.access_token !== 'string' || !body.access_token) throw new AbortTaskRunError('Gmail token response has no access token');
  cachedToken = { token: body.access_token, expiresAt: now + (Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600) * 1000 };
  return cachedToken.token;
}

// The two requests the check makes. Throws AbortTaskRunError for a bad payload.
export function gmailRequestUrl(payload) {
  if (payload?.op === 'list') {
    if (typeof payload.query !== 'string' || !payload.query.trim() || payload.query.length > 500
      || !Number.isInteger(payload.maxResults) || payload.maxResults < 1 || payload.maxResults > 100) throw new AbortTaskRunError('Invalid Gmail search');
    const url = new URL(GMAIL_API);
    url.search = new URLSearchParams({ q: payload.query, maxResults: String(payload.maxResults) }).toString();
    return url.toString();
  }
  if (payload?.op === 'get') {
    if (typeof payload.id !== 'string' || !MESSAGE_ID.test(payload.id)) throw new AbortTaskRunError('Invalid Gmail message id');
    return `${GMAIL_API}/${payload.id}?format=full`;
  }
  throw new AbortTaskRunError('Unknown Gmail request');
}

// One HTTP attempt per child-task attempt. Returns a compact result so run
// outputs stay small: message IDs for a search, the parsed message for a get.
export async function fetchGmail(payload, { signal, env = process.env, fetchRequest = retry.fetch } = {}) {
  signal?.throwIfAborted();
  const url = gmailRequestUrl(payload);
  const token = await gmailAccessToken({ signal, env, fetchRequest });
  const response = await fetchRequest(url, plainFetch({ redirect: 'error', signal,
    headers: { accept: 'application/json', authorization: `Bearer ${token}` } }));
  if (response.status === 401) {
    // A token revoked early: refresh on the next attempt.
    cachedToken = null;
    discardResponseBody(response);
    throw new Error('Gmail HTTP 401');
  }
  if (!response.ok) throw httpFailure('Gmail', response);
  let body;
  try { body = await response.json(); } catch { throw new AbortTaskRunError('Gmail returned a response that is not JSON'); }
  if (payload.op === 'list') return { messages: (Array.isArray(body?.messages) ? body.messages : [])
    .filter(m => typeof m?.id === 'string' && MESSAGE_ID.test(m.id)).map(m => ({ id: m.id, threadId: String(m.threadId || '') })) };
  return parseGmailMessage(body);
}

const decode = data => {
  try { return Buffer.from(String(data || ''), 'base64url').toString('utf8'); } catch { return ''; }
};

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(head|style|script|title)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Quoted earlier messages in a reply.
    .replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, ' ')
    .replace(/<div class="gmail_quote"[\s\S]*$/i, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (match, name) => {
      if (/^#x/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2), 16) || 32);
      if (/^#\d/.test(name)) return String.fromCodePoint(Number(name.slice(1)) || 32);
      return ENTITIES[name.toLowerCase()] ?? match;
    });
}

// Drops quoted replies and signatures-of-history, collapses whitespace and caps the length.
export function cleanBody(text, max = BODY_EXCERPT_MAX) {
  const lines = [];
  for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*On .{1,200}wrote:\s*$/.test(line) || /^-{2,}\s*(Original|Forwarded) Message/i.test(line)
      || /^\s*From:\s.+$/.test(line) && lines.length) break;
    if (/^\s*>/.test(line)) continue;
    lines.push(line.replace(/[\t  ]+/g, ' ').trim());
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

function findPart(part, mimeType) {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts || []) { const found = findPart(child, mimeType); if (found) return found; }
  return null;
}

// The fields the check reads from a `format=full` message.
export function parseGmailMessage(message) {
  if (!message || typeof message.id !== 'string') throw new AbortTaskRunError('Gmail message has no id');
  const headers = new Map((message.payload?.headers || []).map(h => [String(h.name || '').toLowerCase(), String(h.value || '')]));
  const plain = findPart(message.payload, 'text/plain');
  const html = plain ? null : findPart(message.payload, 'text/html');
  const raw = plain ? decode(plain.body.data) : html ? htmlToText(decode(html.body.data)) : '';
  const internal = Number(message.internalDate);
  const headerDate = Date.parse(headers.get('date') || '');
  const date = Number.isFinite(internal) && internal > 0 ? new Date(internal) : Number.isFinite(headerDate) ? new Date(headerDate) : null;
  return {
    messageId: message.id, threadId: String(message.threadId || ''),
    from: headers.get('from') || '', subject: (headers.get('subject') || '').slice(0, 300),
    date: date ? date.toISOString() : '', labelIds: Array.isArray(message.labelIds) ? message.labelIds.map(String) : [],
    listId: (headers.get('list-id') || '').slice(0, 200),
    body: cleanBody(raw),
  };
}
