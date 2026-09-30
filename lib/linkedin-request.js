const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
import { linkedinSettings } from './sanity/analysis-settings.js';

// One client per scan: searches and descriptions share pacing and a wall-clock budget.
export function linkedinRequest({ fetchImpl = fetch, sleep = pause, now = Date.now,
  random = Math.random, onWait = async () => {}, onCooldown = async () => {},
  notBefore = 0, config = linkedinSettings(), budgetMs = config.requestBudgetMinutes * 60_000 } = {}) {
  const backoff = config.retryMinutes.map(minutes => minutes * 60_000);
  const deadline = now() + budgetMs;
  return async url => {
    for (let attempt = 0; ; attempt++) {
      if (notBefore > now()) await delay(notBefore - now(), 'previous rate-limit cooldown');
      await delay(config.requestMinSeconds * 1000 + Math.floor(random() * (config.requestMaxSeconds - config.requestMinSeconds) * 1000), 'throttling');
      let response;
      try {
        response = await fetchImpl(url, { signal: AbortSignal.timeout(25000), redirect: 'manual' });
      } catch { /* Timeouts and network failures use the same bounded retry policy. */ }
      const retryable = !response || response.status === 429 || [500, 502, 503, 504].includes(response.status);
      if (!retryable) return response;
      const reason = response ? `LinkedIn HTTP ${response.status}` : 'LinkedIn request failed or timed out';
      const header = response?.headers.get('retry-after');
      const retryAfter = header && /^\d+(?:\.\d+)?$/.test(header.trim())
        ? Number(header) * 1000 : Math.max(0, Date.parse(header || '') - now()) || 0;
      await response?.body?.cancel();
      const cooldown = Math.max(retryAfter, (backoff[Math.min(attempt, backoff.length - 1)] || 30 * 60_000) + Math.floor(random() * 30_000));
      notBefore = now() + cooldown;
      try { await onCooldown(notBefore); }
      catch (error) { throw Object.assign(error, { fatal: true }); }
      if (attempt >= backoff.length) throw Object.assign(new Error(`${reason}; retries exhausted`), { stop: true });
      await delay(cooldown, reason);
    }
  };

  async function delay(ms, reason) {
    if (now() + ms >= deadline) throw Object.assign(new Error(`LinkedIn request budget exhausted (${reason})`), { stop: true, deferred: true });
    await onWait({ reason, seconds: Math.ceil(ms / 1000) });
    await sleep(ms);
    if (now() >= deadline) throw Object.assign(new Error('LinkedIn request budget exhausted'), { stop: true, deferred: true });
  }
}
