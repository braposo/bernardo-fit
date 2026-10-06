import {AbortTaskRunError,metadata,task} from '@trigger.dev/sdk';
import {executeGeneralCvRefresh} from '../../lib/general-cv-refresh.js';
import {GENERAL_CV_TASK_ID,GENERAL_CV_TASK_POLICY} from '../../lib/task-policy.js';

export const generalCvRefreshTask=task({
  id:GENERAL_CV_TASK_ID,maxDuration:GENERAL_CV_TASK_POLICY.maxDuration,retry:GENERAL_CV_TASK_POLICY.retry,
  queue:{concurrencyLimit:GENERAL_CV_TASK_POLICY.concurrencyLimit},
  run:async(payload:{expectedSourceFingerprint:string;publicUrl:string},{ctx})=>{
    metadata.set('phase','refreshing').set('sourceFingerprint',payload.expectedSourceFingerprint)
      .set('estimatedAiCostMicros',0);
    try {
      const result=await executeGeneralCvRefresh({...payload,runId:ctx.run.id});
      metadata.set('phase',result.outcome).set('publication',result.outcome==='published'?'published':'none');
      return result;
    } catch(error) {
      const code=error && typeof error==='object' && 'code' in error ? String(error.code) : '';
      const status=error && typeof error==='object' && 'status' in error ? Number(error.status) : 0;
      if(code==='GENERAL_CV_DRAFT_EXISTS' || code==='GENERAL_CV_SOURCE_INVALID' ||
        code==='GENERAL_CV_PAGE_MISSING' || code==='GENERAL_CV_PDF_INVALID' ||
        status>=400 && status<500 && code!=='GENERAL_CV_PAGE_CHANGED' && code!=='GENERAL_CV_SOURCE_CHANGED')
        throw new AbortTaskRunError(error instanceof Error?error.message:'General CV refresh cannot continue.');
      throw error;
    }
  },
});
