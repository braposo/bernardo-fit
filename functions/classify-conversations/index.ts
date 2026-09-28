import { scheduledEventHandler } from '@sanity/functions';
import { classificationClient } from './client.js';
import { dispatchPending } from './dispatch.js';

export const handler = scheduledEventHandler(async () => {
  if (!process.env.TRIGGER_SECRET_KEY?.startsWith('tr_prod_') || process.env.TRIGGER_PREVIEW_BRANCH)
    throw new Error('The Sanity scheduler requires the hosted Trigger Production worker');
  const result = await dispatchPending(classificationClient());
  console.log(JSON.stringify(result));
  if (result.failed) throw new Error('Some classification tasks could not be dispatched; snapshots remain pending');
});
