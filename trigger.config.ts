import { defineConfig } from "@trigger.dev/sdk";
import {additionalFiles,syncEnvVars} from '@trigger.dev/build/extensions/core';
import {playwright} from '@trigger.dev/build/extensions/playwright';

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
  // pdfjs-dist resolves its own pdf.worker.mjs next to the package at runtime.
  // Keep the package external so bundling does not orphan that worker module.
  build:{external:['playwright','playwright-core','chromium-bidi','pdfjs-dist'],extensions:[playwright({browsers:['chromium']}),additionalFiles({files:['./lib/assets/cv-fonts/**']}),syncEnvVars(async (ctx)=>{
    // Opt-in branch deployment only. Never copy local settings into production.
    if(ctx.environment!=='preview' || process.env.SANITY_CONTENT_ENABLED!=='1')return [];
    return ['SANITY_WRITE_TOKEN','SANITY_READ_TOKEN','SANITY_CONTENT_ENABLED','SANITY_ANALYSIS_ENABLED','KV_NAMESPACE']
      .filter(name=>process.env[name]).map(name=>({name,value:process.env[name]!,isSecret:name.endsWith('_TOKEN')}));
  })]},
});
