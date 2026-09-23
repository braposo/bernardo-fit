import { defineConfig } from "@trigger.dev/sdk";
import {syncEnvVars} from '@trigger.dev/build/extensions/core';

export default defineConfig({
  project: "proj_bvmrmtvfeyxpshabcxqv",
  runtime: "node-24",
  logLevel: "log",
  // The max compute seconds a task is allowed to run. If the task run exceeds this duration, it will be stopped.
  // You can override this on an individual task.
  // See https://trigger.dev/docs/runs/max-duration
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./src/trigger"],
  build:{extensions:[syncEnvVars(async (ctx)=>{
    // Opt-in branch deployment only. Never copy local settings into production.
    if(ctx.environment!=='preview' || process.env.SANITY_CONTENT_ENABLED!=='1')return [];
    return ['SANITY_WRITE_TOKEN','SANITY_READ_TOKEN','SANITY_CONTENT_ENABLED','SANITY_ANALYSIS_ENABLED','KV_NAMESPACE']
      .filter(name=>process.env[name]).map(name=>({name,value:process.env[name]!,isSecret:name.endsWith('_TOKEN')}));
  })]},
});
