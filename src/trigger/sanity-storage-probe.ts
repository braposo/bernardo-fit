import {task} from '@trigger.dev/sdk';
import {verifySanityStorage} from '../../lib/sanity/verify-storage.js';

export const sanityStorageProbe = task({
  id:'sanity-storage-probe',maxDuration:180,retry:{maxAttempts:1},
  run:async()=>verifySanityStorage(),
});
