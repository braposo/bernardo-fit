import {runAnalysis} from '../../lib/analyze.js';
import {runCoverLetter} from '../../lib/cover.js';
import {runAnswer} from '../../lib/answer.js';
import {task, AbortTaskRunError} from '@trigger.dev/sdk';
import {assertActiveOwner} from '../../lib/provider-lifecycle.js';
import {withChildGenerationContext} from '../../lib/generation-context.js';
import {withSettingsSnapshot} from '../../lib/sanity/analysis-settings.js';
import {validateRequestLifecycle} from '../../lib/sanity/request-lifecycle.js';
import {evaluateJev} from '../../lib/jev.js';
import {complete as openai} from '../../lib/openai.js';
import {complete as anthropic} from '../../lib/anthropic.js';

export const durableModelCall=task({
  id:'durable-model-call',maxDuration:900,retry:{maxAttempts:1},queue:{concurrencyLimit:6},
  run:async(payload:{provider:string;args:any;settings:any;policy:any;attribution:any;ownerRunId:string},{ctx,signal})=>{
    const execute: any = {jev:evaluateJev,openai,anthropic,cover:runCoverLetter,answer:runAnswer,
      analysis: ({jobDescription,...options}:any)=>runAnalysis(jobDescription,options)}[payload.provider];
    if(!execute || !payload.settings?.fingerprint)throw new AbortTaskRunError('Invalid model call');
    await assertActiveOwner(payload.ownerRunId);
    const policy=validateRequestLifecycle(payload.policy);
    return withSettingsSnapshot({...payload.settings,requestLifecycle:policy},()=>
      withChildGenerationContext({...payload.attribution,runId:ctx.run.id,ownerRunId:payload.ownerRunId,taskAttempt:ctx.attempt.number,modelTask:true},()=>
        execute({...payload.args,signal})));
  },
});
