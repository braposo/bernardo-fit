import { idempotencyKeys, tasks } from '@trigger.dev/sdk';

export function londonSchedule(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return { due: parts.hour === '09', date: `${parts.year}-${parts.month}-${parts.day}` };
}

export async function dispatchLinkedIn({ now = new Date(), env = process.env, trigger = tasks.trigger } = {}) {
  const { due, date } = londonSchedule(now);
  if (!due) return { status: 'outside-london-9am', date };
  if (!env.TRIGGER_SECRET_KEY?.startsWith('tr_prod_') || env.TRIGGER_PREVIEW_BRANCH)
    throw new Error('LinkedIn scheduling requires the hosted Trigger Production worker');
  const idempotencyKey = await idempotencyKeys.create(['linkedin-job-discovery', date], { scope: 'global' });
  const run = await trigger('linkedin-job-discovery', { date }, { idempotencyKey, idempotencyKeyTTL: '30d' });
  return { status: 'dispatched', date, runId: run.id };
}
