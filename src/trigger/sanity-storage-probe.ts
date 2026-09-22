import {task} from '@trigger.dev/sdk';
import {verifySanityStorage} from '../../lib/sanity/verify-storage.js';

export const sanityStorageProbe = task({
  id:'sanity-storage-probe',maxDuration:180,retry:{maxAttempts:1},
  run:async(payload:{configurationOnly?:boolean}={})=>{
    const configuration={
      redis:!!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN,
      openai:!!process.env.OPENAI_API_KEY,anthropic:!!process.env.ANTHROPIC_API_KEY,
      typesafe:!!process.env.TYPESAFE_API_KEY,namespace:process.env.KV_NAMESPACE || '',
      sanity:process.env.SANITY_CONTENT_ENABLED==='1',analysis:process.env.SANITY_ANALYSIS_ENABLED==='1',
    };
    return payload.configurationOnly?{configuration}:{...await verifySanityStorage(),configuration};
  },
});
