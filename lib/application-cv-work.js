import {getJob,getReport} from './store.js';
import {publicReport} from './report.js';
import {loadApplicationCvSource} from './application-cv-source.js';
import {getApplicationCv,getApplicationCvVersion,updateApplicationCvRun,saveApplicationCvVersion,
  publishApplicationCvVersion} from './application-cv-store.js';
import {applicationCvFingerprint,applicationCvJobFingerprint} from './application-cv-fingerprint.js';
import {approvedWordingApplicationCv,generateApplicationCvSelection,layoutRevisionFeedback,materializeApplicationCv,
  validateApplicationCv,verifyApplicationCv} from './application-cv-generation.js';
import {measureApplicationCvBudget,renderApplicationCvPdf} from './application-cv-render.js';
import {buildDetailedCvContent,defaultDetailedSelection,fitDetailedCv,generateDetailedCvSelection,isDetailedSource,
  normalizeDetailedSelection,validateDetailedCv} from './application-cv-detailed.js';
import {readUsage} from './usage.js';
import {durableModelCall} from './provider-lifecycle.js';

const finalStatus = () => new Date().toISOString();
const isTerminal = error => error?.abort || error?.status === 404 || error?.status === 422;
const errorIssue = error => ({code:error?.code || 'CV_GENERATION_FAILED',message:error?.message || 'CV generation failed.'});
export const APPLICATION_CV_TEMPLATE_VERSION='application-cv-6';
// A draft that only fails on length (over one page or over maxWords) goes back
// to the writer with its measurements. This is semantic output repair inside
// the CV task, not a transport retry: each attempt is its own checkpointed call.
export const APPLICATION_CV_WRITER_ATTEMPTS=3;
const LENGTH_ISSUES=new Set(['CV_PDF_OVERFLOW','CV_PDF_PAGES','WORD_LIMIT']);
export const APPLICATION_CV_RENDERER_VERSION='a4-one-column-10';
export const APPLICATION_CV_DETAILED_TEMPLATE_VERSION='application-cv-detailed-1';
export const APPLICATION_CV_DETAILED_RENDERER_VERSION='a4-two-page-1';

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

async function renderWithinPage(content,sourceSnapshot,issues,overflow={}) {
  try {return await renderApplicationCvPdf(content,{minBodyPx:sourceSnapshot.settings.minBodyPx});}
  catch (error) {if (!['CV_PDF_OVERFLOW','CV_PDF_PAGES'].includes(error?.code)) throw error;issues.push(errorIssue(error));overflow.layout=error.layout || null;return null;}
}

// The two-page CV quotes approved Sanity text only. One model call orders each
// role's achievements; an unusable answer falls back to the editorial order.
// Achievements are then dropped, oldest roles first, until the page limit fits.
async function writeDetailed({payload,sourceSnapshot,reportSnapshot,model,requestId,fitUrl,adjustments,onPhase}) {
  const {selection:raw}=await durableModelCall('cv-detailed',{job:payload.jobSnapshot,sourceSnapshot,reportSnapshot,
    model,requestId,versionInstructions:payload.versionInstructions},generateDetailedCvSelection);
  let selection;
  try {selection=normalizeDetailedSelection(sourceSnapshot,raw);}
  catch (error) {if (!isTerminal(error)) throw error;adjustments.push(errorIssue(error));selection=defaultDetailedSelection(sourceSnapshot);}
  if (!await stillOwned(payload)) return {superseded:true};
  onPhase('rendering');
  await updateApplicationCvRun(payload.jobId,requestId,{phase:'rendering'});
  const fitted=await fitDetailedCv(sourceSnapshot,selection,{build:current=>buildDetailedCvContent(sourceSnapshot,current,{fitUrl}),
    render:renderApplicationCvPdf});
  if (fitted.trimmed) adjustments.push({code:'CV_ACHIEVEMENTS_TRIMMED',message:`Fewer achievements were kept to fit ${sourceSnapshot.settings.pages} pages.`});
  const validation=validateDetailedCv(fitted.content,sourceSnapshot,fitted.requirementMap);
  if (validation.status!=='valid') throw Object.assign(new Error('The two-page CV failed factual validation.'),{status:422,code:'CV_INVALID',abort:true,issues:validation.issues});
  return {materialized:fitted,validation,rendered:fitted.rendered,
    verification:{status:'valid',issues:[],overviewCoverage:sourceSnapshot.roles.map(role=>({roleId:role.id,covered:true,method:'verbatim'}))}};
}

async function writeWithinPage({payload,sourceSnapshot,reportSnapshot,model,requestId,fitUrl,layoutBudget,adjustments,onPhase}) {
  let revision=null,selection=null;
  for (let attempt=1;attempt<=APPLICATION_CV_WRITER_ATTEMPTS;attempt++) {
    ({selection}=await durableModelCall('cv',{job:payload.jobSnapshot,sourceSnapshot,reportSnapshot,
      model,requestId,versionInstructions:payload.versionInstructions,layoutBudget,...(revision?{revision}:{})},generateApplicationCvSelection));
    const issues=[],overflow={};
    let materialized=null,validation=null,rendered=null;
    try {materialized=materializeApplicationCv(sourceSnapshot,selection,fitUrl);}
    catch (error) {if (!isTerminal(error)) throw error;issues.push(errorIssue(error));}
    if (materialized) {
      validation=validateApplicationCv(materialized.content,sourceSnapshot,materialized.requirementMap);
      if (validation.status!=='valid') {issues.push(...validation.issues);materialized=null;}
    }
    // The page check is free, so it runs before the paid factual verifier.
    if (materialized) rendered=await renderWithinPage(materialized.content,sourceSnapshot,issues,overflow);
    if (rendered) {
      onPhase('verifying');
      await updateApplicationCvRun(payload.jobId,requestId,{phase:'verifying'});
      const checked=await durableModelCall('cv-verify',{content:materialized.content,sourceSnapshot,model,requestId},
        verifyApplicationCv);
      const verification={status:checked.status,issues:checked.issues,overviewCoverage:checked.overviewCoverage||[]};
      if (checked.status==='valid') return {selection,materialized,validation,verification,rendered};
      adjustments.push(...checked.issues);
      return {selection};
    }
    adjustments.push(...issues);
    if (!issues.length || !issues.every(issue => LENGTH_ISSUES.has(issue.code)) || attempt===APPLICATION_CV_WRITER_ATTEMPTS) return {selection};
    if (!await stillOwned(payload)) return {selection,superseded:true};
    revision={attempt:attempt+1,feedback:layoutRevisionFeedback({selection,issues,layout:overflow.layout,budget:layoutBudget,sourceSnapshot})};
  }
  return {selection};
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
  const adjustments=[];
  try {
    if (isDetailedSource(sourceSnapshot)) {
      const written=await writeDetailed({payload,sourceSnapshot,reportSnapshot,model,requestId,fitUrl,adjustments,onPhase});
      if (written.superseded || !await stillOwned(payload)) return supersede(payload);
      const usage=await usageFor(requestId);
      onPhase('saving');
      const saved=await saveApplicationCvVersion(jobId,{...base,templateVersion:APPLICATION_CV_DETAILED_TEMPLATE_VERSION,
        rendererVersion:APPLICATION_CV_DETAILED_RENDERER_VERSION,content:written.materialized.content,verification:written.verification,
        pdfBytes:written.rendered.pdfBytes,pdfSha256:written.rendered.pdfSha256,usage,
        validation:{...written.validation,layout:written.rendered.layout,...(adjustments.length?{adjusted:{reason:'two_page_fit',issues:adjustments}}:{})}});
      return finishSavedVersion(payload,saved);
    }
    // Measure the free space first so the writer can budget its text to fit.
    const layoutBudget=await measureApplicationCvBudget(approvedWordingApplicationCv(sourceSnapshot,{roles:[]},fitUrl,1).content,
      {minBodyPx:sourceSnapshot.settings.minBodyPx});
    const written=await writeWithinPage({payload,sourceSnapshot,reportSnapshot,model,requestId,fitUrl,layoutBudget,adjustments,onPhase});
    if (written.superseded) return supersede(payload);
    const {selection}=written;
    let {materialized=null,validation=null,rendered=null}=written;
    let verification=written.verification || {status:'not_run',issues:[],overviewCoverage:[]};
    const current=await stillOwned(payload);
    if (!current) return supersede(payload);
    onPhase('rendering');
    await updateApplicationCvRun(jobId,requestId,{phase:'rendering'});
    // Rewritten lines that fail a factual check, or drafts still too long after
    // the rewrites, are replaced by the approved evidence they cite, so a usable
    // CV is published without a review step. Fewer lines per role are tried
    // until the page fits.
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
