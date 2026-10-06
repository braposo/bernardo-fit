import {AbortTaskRunError,metadata,task} from '@trigger.dev/sdk';
import {withGenerationContext} from '../../lib/generation-context.js';
import {executeApplicationCvWork} from '../../lib/application-cv-work.js';
import {updateApplicationCvRun} from '../../lib/application-cv-store.js';
import {CV_TASK_POLICY} from '../../lib/task-policy.js';

export type ApplicationCvPayload = {
  jobId:string;requestId:string;fingerprint:string;model:string;origin:string;
  jobSnapshot:{id:string;company:string;role:string;jobDescription:string;instructions:string;fitReportId?:string};
  sourceSnapshot:any;reportSnapshot:any;reportId:string;versionInstructions?:string;
};

export const applicationCvTask=task({
  id:'application-cv',maxDuration:CV_TASK_POLICY.maxDuration,retry:CV_TASK_POLICY.retry,
  queue:{concurrencyLimit:CV_TASK_POLICY.concurrencyLimit},
  catchError:async({payload,error,ctx})=>{
    if(ctx.attempt.number>=CV_TASK_POLICY.retry.maxAttempts || error instanceof AbortTaskRunError){
      try {await updateApplicationCvRun(payload.jobId,payload.requestId,{status:'failed',phase:'failed',
        error:error instanceof Error ? error.message.slice(0,300) : 'CV generation failed.',
        finishedAt:new Date().toISOString()});}catch{/* a superseding run owns this job */}
    }
  },
  run:async(payload:ApplicationCvPayload,{ctx})=>withGenerationContext({jobId:payload.jobId,reportId:payload.reportId,
    requestId:payload.requestId,runId:ctx.run.id,taskAttempt:ctx.attempt.number},async()=>{
    metadata.set('phase','loading').set('jobId',payload.jobId).set('requestId',payload.requestId).set('model',payload.model);
    try {
      const result=await executeApplicationCvWork(payload,{onPhase:phase=>metadata.set('phase',phase)});
      metadata.set('phase',result.outcome).set('publication',result.publication||'none');
      if(result.usage)metadata.set('inputTokens',result.usage.inputTokens).set('outputTokens',result.usage.outputTokens)
        .set('estimatedAiCostMicros',result.usage.estimatedAiCostMicros);
      return result;
    } catch(error) {
      if(error && typeof error==='object' && ('abort' in error ||
        ('status' in error && Number(error.status)<500)))
        throw new AbortTaskRunError(error instanceof Error ? error.message : 'CV generation cannot continue.');
      throw error;
    }
  }),
});
