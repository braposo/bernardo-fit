import { scheduledEventHandler } from '@sanity/functions';
import { dispatchLinkedIn } from './schedule.js';

export const handler = scheduledEventHandler(async () => {
  console.log(JSON.stringify(await dispatchLinkedIn()));
});
