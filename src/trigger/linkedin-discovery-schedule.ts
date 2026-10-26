import { schedules } from '@trigger.dev/sdk';
import { londonSchedule, triggerLinkedInDiscovery } from '../../functions/discover-linkedin/schedule.js';

// Trigger owns the daily 09:00 London schedule, so daylight saving needs no guard.
// The Sanity discover-linkedin function uses the same date key, so a run it dispatches is not repeated.
export const linkedinDiscoverySchedule = schedules.task({
  id: 'linkedin-discovery-schedule',
  cron: { pattern: '0 9 * * *', timezone: 'Europe/London', environments: ['PRODUCTION'] },
  maxDuration: 60,
  run: async (payload) => triggerLinkedInDiscovery(londonSchedule(payload.timestamp).date),
});
