import { queue } from '@trigger.dev/sdk';

// Discovery sources run one at a time, so two sources never admit the same new job at once.
export const discoveryQueue = queue({ name: 'job-discovery', concurrencyLimit: 1 });
