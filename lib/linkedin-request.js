import { AbortTaskRunError, retry } from '@trigger.dev/sdk';

// Provider-specific interpretation only. Trigger owns attempts, delays and timeouts.
export function retryAfterDate(value, now = Date.now()) {
  if (!value) return undefined;
  const timestamp = /^\d+(?:\.\d+)?$/.test(value.trim()) ? now + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > now ? new Date(timestamp) : undefined;
}

export function linkedInRetryPolicy({ payload, error }) {
  if (error?.name === 'AbortTaskRunError') return { skipRetrying: true };
  return { retry: payload.policy.retry, ...(error?.retryAt ? { retryAt: error.retryAt } : {}) };
}

export async function fetchLinkedInPage({ url, policy }, { signal, fetchRequest = retry.fetch } = {}) {
  signal?.throwIfAborted();
  let target;
  try { target = new URL(url); }
  catch { throw new AbortTaskRunError('Unsupported LinkedIn public endpoint'); }
  if (target.origin !== 'https://www.linkedin.com' || target.username || target.password ||
    !(target.pathname === '/jobs/search/' || /^\/jobs-guest\/jobs\/api\/jobPosting\/\d+$/.test(target.pathname)))
    throw new AbortTaskRunError('Unsupported LinkedIn public endpoint');
  // Exactly one HTTP attempt per child-task attempt. Avoid multiplying SDK and task retries.
  const response = await fetchRequest(url, { redirect: 'manual', signal,
    timeoutInMs: policy.requestTimeoutSeconds * 1000,
    retry: { byStatus: {}, timeout: { maxAttempts: 1 }, connectionError: { maxAttempts: 1 } },
  });
  if (!response.ok) {
    const message = `LinkedIn HTTP ${response.status}`;
    const retryAt = retryAfterDate(response.headers.get('retry-after'));
    await response.body?.cancel();
    if ([408, 429, 500, 502, 503, 504].includes(response.status))
      throw Object.assign(new Error(message), { retryAt });
    if ([301,302,303,307,308,401,403,999].includes(response.status)) throw new AbortTaskRunError(message);
    return { status: response.status, body: '' };
  }
  const body = await response.text();
  if (/captcha-internal|\/checkpoint\/challenge|<title>[^<]*(?:sign in|security verification|authwall)/i.test(body))
    throw new AbortTaskRunError('LinkedIn requires authentication or a challenge');
  return { status: response.status, body };
}
