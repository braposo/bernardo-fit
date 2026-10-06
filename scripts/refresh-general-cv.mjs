import {pathToFileURL} from 'node:url';
import {planGeneralCvRefresh,GENERAL_CV_PUBLIC_URL} from '../lib/general-cv-refresh.js';
import {GENERAL_CV_TASK_ID} from '../lib/task-policy.js';

const usage='Usage: refresh-general-cv.mjs [--dry-run] [--apply --branch codex/personalised-cv] [--retry-key name]';
let apply=false,dryRun=false,branch='',retryKey='';
const args=process.argv.slice(2);
for(let i=0;i<args.length;i++){
  const arg=args[i];
  if(arg==='--apply')apply=true;
  else if(arg==='--dry-run')dryRun=true;
  else if(arg==='--branch' || arg==='--retry-key'){
    const value=args[++i];
    if(!value || value.startsWith('--'))throw Error(usage);
    if(arg==='--branch')branch=value;else retryKey=value;
  } else throw Error(usage);
}
if(apply && dryRun)throw Error(usage);

export async function refreshGeneralCv({apply=false,branch='',retryKey='',plan=planGeneralCvRefresh,
  sdk=()=>import('@trigger.dev/sdk')}={}) {
  const planned=await plan({publicUrl:GENERAL_CV_PUBLIC_URL});
  if(!apply || !planned.needed)return {...planned,triggered:false};
  if(!/^codex\/[a-z0-9-]+$/.test(branch))throw Error('A named Development branch is required for the CV refresh.');
  if(!process.env.TRIGGER_SECRET_KEY?.startsWith('tr_dev_'))throw Error('Use the Trigger Development key for this one-off refresh.');
  process.env.TRIGGER_PREVIEW_BRANCH=branch;
  const {tasks,runs,idempotencyKeys}=await sdk();
  const key=await idempotencyKeys.create(`general-cv:${planned.sourceFingerprint}:${planned.templateVersion}:${planned.rendererVersion}:${retryKey}`,{scope:'global'});
  const handle=await tasks.trigger(GENERAL_CV_TASK_ID,{expectedSourceFingerprint:planned.sourceFingerprint,
    publicUrl:GENERAL_CV_PUBLIC_URL},{idempotencyKey:key});
  const finished=run=>({triggered:true,runId:handle.id,status:run.status,
    outcome:run.output?.outcome||'',sourceFingerprint:planned.sourceFingerprint,
    pdfSha256:run.output?.pdfSha256||'',aiCostMicros:run.output?.aiCostMicros??0});
  let run=await runs.retrieve(handle.id);
  if(run.isCompleted)return finished(run);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180_000);
  try {
    for await(const update of runs.subscribeToRun(handle.id,{signal:controller.signal})){
      run=update;
      if(run.isCompleted)return finished(run);
    }
    run=await runs.retrieve(handle.id);
    if(run.isCompleted)return finished(run);
    throw Error(`CV refresh ${handle.id} is still ${run.status}; inspect that Trigger run before retrying.`);
  } catch(error) {
    if(!controller.signal.aborted)throw error;
    run=await runs.retrieve(handle.id);
    if(run.isCompleted)return finished(run);
    throw Error(`CV refresh ${handle.id} is still ${run.status} after the bounded wait; inspect the Trigger run before retrying.`);
  } finally {clearTimeout(timer);controller.abort();}
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try {
    const result=await refreshGeneralCv({apply,branch,retryKey});
    console.log(JSON.stringify(result));
    if(result.triggered && result.status!=='COMPLETED')process.exitCode=1;
  } catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
}
