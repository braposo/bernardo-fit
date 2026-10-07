import {getJob,getReport} from './store.js';
import {publicReport} from './report.js';
import {loadApplicationCvSource} from './application-cv-source.js';
import {getApplicationCv,getApplicationCvVersion,updateApplicationCvRun,saveApplicationCvVersion,
  publishApplicationCvVersion} from './application-cv-store.js';
import {applicationCvFingerprint,applicationCvJobFingerprint} from './application-cv-fingerprint.js';
import {approvedWordingApplicationCv,generateApplicationCvSelection,materializeApplicationCv,validateApplicationCv,
  verifyApplicationCv} from './application-cv-generation.js';
import {renderApplicationCvPdf} from './application-cv-render.js';
import {readUsage} from './usage.js';
import {durableModelCall} from './provider-lifecycle.js';

const finalStatus = () => new Date().toISOString();
const isTerminal = error => error?.abort || error?.status === 404 || error?.status === 422;
const errorIssue = error => ({code:error?.code || 'CV_GENERATION_FAILED',message:error?.message || 'CV generation failed.'});
export const APPLICATION_CV_TEMPLATE_VERSION='application-cv-5';
export const APPLICATION_CV_RENDERER_VERSION='a4-one-column-10';

async function usageFor(requestId) {
  const entries=(await readUsage(requestId)).filter(entry => ['cv','cv-verify'].includes(entry.kind));
  const total=field => entries.reduce((sum,entry) => sum+(Number(entry[field])||0),0);
  return {calls:entries.length,inputTokens:total('input')+total('cacheRead')+total('cacheWrite'),
    outputTokens:total('output'),estimatedAiCostMicros:entries.length && entries.every(entry => entry.estimatedCostMicros != null)
      ?total('estimatedCostMicros'):null,entries:entries.map(({at,kind,model,input,output,cacheRead,cacheWrite,
      estimatedCostMicros,httpStatus,runId}) => ({at,kind,model,input,output,cacheRead,cacheWrite,
        estimatedCostMicros,httpStatus,runId}))};
}

function fitUrlFor(origin,publicId) {
  let url;try {url=new URL(origin);}catch {throw Object.assign(new Error('A valid public origin is required.'),{abort:true});}
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw Object.assign(new Error('A valid public origin is required.'),{abort:true});
  return new URL(`/fit/${encodeURIComponent(publicId)}`,url).href;
}

async function freshInputs(payload) {
  const job=await getJob(payload.jobId);
  if (!job || job.id !== payload.jobId) return null;
  const report=job.fitReportId ? await getReport(job.fitReportId) : null;
  if (!report) return null;
  const source=await loadApplicationCvSource(job);
  const reportSnapshot={id:job.fitReportId,report:publicReport(report)};
  const fingerprint=applicationCvFingerprint(job,source,reportSnapshot,payload.model,payload.versionInstructions || '');
  return {job,source,reportSnapshot,fingerprint};
}

async function stillOwned(payload,{checkSource=true}={}) {
  const app=await getApplicationCv(payload.jobId);
  if (app?.run?.requestId!==payload.requestId || app.run.fingerprint!==payload.fingerprint) return null;
  if (!checkSource) return {app};
  const current=await freshInputs(payload);
  if (!current || current.fingerprint!==payload.fingerprint) return null;
  return {...current,app};
}

async function supersede(payload) {
  try {await updateApplicationCvRun(payload.jobId,payload.requestId,{status:'superseded',phase:'superseded',finishedAt:finalStatus()});}
  catch (error) {if (error?.code!=='APPLICATION_CV_RUN_REPLACED') throw error;}
  return {outcome:'superseded',jobId:payload.jobId,requestId:payload.requestId};
}

async function finishSavedVersion(payload,saved) {
  const latest=await stillOwned(payload);
  if (!latest) return supersede(payload);
  const {jobId,requestId,fingerprint}=payload;
  const usage=saved.usage || await usageFor(requestId);
  if (latest.app.currentVersionId===saved.id) return {outcome:'completed',publication:'published',
    jobId,requestId,versionId:saved.id,usage};
  if (latest.job.archived || ['applied','interviewing','offer'].includes(latest.job.stage) || latest.app.submittedVersionId) {
    if(latest.app.run.status!=='completed')await updateApplicationCvRun(jobId,requestId,{status:'completed',phase:'saved',
      versionId:saved.id,publication:'saved',finishedAt:finalStatus()});
    return {outcome:'completed',publication:'saved',jobId,requestId,versionId:saved.id,usage};
  }
  if(latest.app.run.status==='completed')return {outcome:'completed',publication:'saved',
    jobId,requestId,versionId:saved.id,usage};
  await publishApplicationCvVersion(jobId,saved.id,{expectedRequestId:requestId,expectedFingerprint:fingerprint});
  return {outcome:'completed',publication:'published',jobId,requestId,versionId:saved.id,usage};
}

async function renderWithinPage(content,sourceSnapshot,adjustments) {
  try {return await renderApplicationCvPdf(content,{minBodyPx:sourceSnapshot.settings.minBodyPx});}
  catch (error) {if (error?.code!=='CV_PDF_OVERFLOW') throw error;adjustments.push(errorIssue(error));return null;}
}

export async function executeApplicationCvWork(payload,{onPhase=()=>{}}={}) {
  const {jobId,requestId,fingerprint,model,sourceSnapshot,reportSnapshot}=payload;
  const owned=await stillOwned(payload);
  if (!owned) return supersede(payload);
  if (sourceSnapshot?.fingerprint!==owned.source.fingerprint ||
    JSON.stringify(reportSnapshot)!==JSON.stringify(owned.reportSnapshot) ||
    applicationCvFingerprint(payload.jobSnapshot,sourceSnapshot,reportSnapshot,model,payload.versionInstructions || '')!==fingerprint)
    return supersede(payload);
  const existing=await getApplicationCvVersion(jobId,requestId);
  if(existing?.validation?.status==='valid' && existing.pdfSha256)return finishSavedVersion(payload,existing);
  if(existing?.validation?.status==='needs_review'){
    if(owned.app.run.status!=='needs_review')await updateApplicationCvRun(jobId,requestId,{status:'needs_review',
      phase:'needs_review',versionId:existing.id,validation:existing.validation,finishedAt:finalStatus()});
    return {outcome:'needs_review',jobId,requestId,versionId:existing.id,
      validation:existing.validation,usage:existing.usage || await usageFor(requestId)};
  }
  const fitUrl=fitUrlFor(payload.origin,owned.app.publicId);
  onPhase('writing');
  await updateApplicationCvRun(jobId,requestId,{status:'running',phase:'writing'});
  const base={id:requestId,jobId,createdAt:new Date().toISOString(),fingerprint,
    jobFingerprint:applicationCvJobFingerprint(owned.job),sourceFingerprint:sourceSnapshot.fingerprint,
    sourceSnapshot,reportSnapshot,model,versionInstructions:payload.versionInstructions || '',
    templateVersion:APPLICATION_CV_TEMPLATE_VERSION,rendererVersion:APPLICATION_CV_RENDERER_VERSION};
  let selection=null;
  const adjustments=[];
  try {
    ({selection}=await durableModelCall('cv',{job:payload.jobSnapshot,sourceSnapshot,reportSnapshot,
      model,requestId,versionInstructions:payload.versionInstructions},generateApplicationCvSelection));
    let materialized=null,validation=null,verification={status:'not_run',issues:[],overviewCoverage:[]};
    try {materialized=materializeApplicationCv(sourceSnapshot,selection,fitUrl);}
    catch (error) {if (!isTerminal(error)) throw error;adjustments.push(errorIssue(error));}
    if (materialized) {
      validation=validateApplicationCv(materialized.content,sourceSnapshot,materialized.requirementMap);
      if (validation.status!=='valid') {adjustments.push(...validation.issues);materialized=null;}
    }
    if (materialized) {
      onPhase('verifying');
      await updateApplicationCvRun(jobId,requestId,{phase:'verifying'});
      const checked=await durableModelCall('cv-verify',{content:materialized.content,sourceSnapshot,model,requestId},
        verifyApplicationCv);
      verification={status:checked.status,issues:checked.issues,overviewCoverage:checked.overviewCoverage||[]};
      if (checked.status!=='valid') {adjustments.push(...checked.issues);materialized=null;}
    }
    const current=await stillOwned(payload);
    if (!current) return supersede(payload);
    onPhase('rendering');
    await updateApplicationCvRun(jobId,requestId,{phase:'rendering'});
    let rendered=materialized && await renderWithinPage(materialized.content,sourceSnapshot,adjustments);
    // Rewritten lines that fail a factual or layout check are replaced by the
    // approved evidence they cite, so a usable CV is published without a
    // review step. Fewer lines per role are tried until the page fits.
    for (const perRole of [3,2,1]) {
      if (rendered) break;
      const candidate=approvedWordingApplicationCv(sourceSnapshot,selection,fitUrl,perRole);
      const checked=validateApplicationCv(candidate.content,sourceSnapshot,candidate.requirementMap);
      if (checked.status!=='valid') continue;
      rendered=await renderWithinPage(candidate.content,sourceSnapshot,[]);
      if (rendered) {materialized=candidate;validation=checked;
        verification={status:'valid',issues:[],overviewCoverage:sourceSnapshot.roles.map(role=>({roleId:role.id,covered:true,method:'verbatim'}))};}
    }
    if (!rendered) throw Object.assign(new Error('The approved career evidence does not fit a one-page CV. Shorten it in Sanity, then generate again.'),
      {status:422,code:'CV_SOURCE_UNFIT',abort:true});
    if (!await stillOwned(payload)) return supersede(payload);
    const usage=await usageFor(requestId);
    onPhase('saving');
    const saved=await saveApplicationCvVersion(jobId,{...base,content:materialized.content,verification,
      pdfBytes:rendered.pdfBytes,pdfSha256:rendered.pdfSha256,usage,
      validation:{...validation,layout:rendered.layout,...(adjustments.length?{adjusted:{reason:'approved_wording',issues:adjustments}}:{})}});
    return finishSavedVersion(payload,saved);
  } catch (error) {
    if (error?.code === 'APPLICATION_CV_RUN_REPLACED' || error?.code === 'APPLICATION_CV_STALE') return supersede(payload);
    throw error;
  }
}
