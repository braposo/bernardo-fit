import {createHash} from 'node:crypto';
import {createContentClient,createStorageClient} from './sanity/client.js';
import {loadApplicationCvSource} from './application-cv-source.js';
import {buildGeneralApplicationCv,renderGeneralApplicationCv} from './application-cv-general.js';
import {renderApplicationCvPdf} from './application-cv-render.js';
import {GENERAL_CV_PUBLIC_URL,GENERAL_CV_PAGE_QUERY,generalCvPageAvailable} from './general-cv-availability.js';

export {GENERAL_CV_PUBLIC_URL,generalCvPageAvailable,getGeneralCvAvailability} from './general-cv-availability.js';

export const GENERAL_CV_TEMPLATE_VERSION='general-cv-1';
export const GENERAL_CV_RENDERER_VERSION='general-a4-one-column-7';
export const GENERAL_CV_DETAILED_TEMPLATE_VERSION='general-cv-detailed-1';
export const GENERAL_CV_DETAILED_RENDERER_VERSION='general-a4-two-page-1';
const versionsFor=source=>source?.settings?.layout==='detailed'
  ? {templateVersion:GENERAL_CV_DETAILED_TEMPLATE_VERSION,rendererVersion:GENERAL_CV_DETAILED_RENDERER_VERSION}
  : {templateVersion:GENERAL_CV_TEMPLATE_VERSION,rendererVersion:GENERAL_CV_RENDERER_VERSION};
const isCurrent=(page,source,sourceFingerprint)=>{
  const {templateVersion,rendererVersion}=versionsFor(source);
  return generalCvPageAvailable(page) && page.generalCv.sourceFingerprint===sourceFingerprint &&
    page.generalCv.rendererVersion===rendererVersion && page.generalCv.templateVersion===templateVersion;
};
const DRAFT_QUERY='count(*[_id in $ids])';
const fail=(code,message,status=409)=>Object.assign(new Error(message),{code,status});
const digest=value=>createHash('sha256').update(value).digest('hex');
const json=value=>({_type:'applicationCvJson',payload:JSON.stringify(value)});

function semanticEvidence(evidence) {
  return {id:evidence.id,text:evidence.text,sourceRef:{documentId:evidence.sourceRef?.documentId,
    passage:evidence.sourceRef?.passage},contribution:evidence.contribution,status:evidence.status,skills:evidence.skills||[]};
}
const semanticSection=section=>({id:section.id,title:section.title,company:section.company||'',dates:section.dates||'',
  location:section.location||'',overviewEvidenceId:section.overviewEvidenceId||'',
  generalEvidenceIds:section.generalEvidenceIds||[],links:section.links||[],
  evidence:(section.evidence||[]).map(semanticEvidence),...(section.detail?{detail:section.detail}:{})});

export function generalCvFingerprint(source,{publicUrl=GENERAL_CV_PUBLIC_URL}={}) {
  if(!source?.identity || !Array.isArray(source.roles) || !source.roles.length)
    throw fail('GENERAL_CV_SOURCE_INVALID','Published general CV source is incomplete.',503);
  return digest(JSON.stringify({identity:source.identity,roles:source.roles.map(semanticSection),
    education:(source.education||[]).map(semanticSection),projects:(source.projects||[]).map(semanticSection),
    layout:{minBodyPx:source.settings?.minBodyPx,maxWords:source.settings?.maxWords,
      // Two-page settings join the fingerprint only once that layout is published.
      ...(source.settings?.layout==='detailed'?{name:'detailed',pages:source.settings.pages}:{})},
    ...(source.profile?{profile:source.profile}:{}),publicUrl}));
}

export async function planGeneralCvRefresh({client=createContentClient(),publicUrl=GENERAL_CV_PUBLIC_URL,
  loadSource=loadApplicationCvSource}={}) {
  const [source,page]=await Promise.all([loadSource(null,client),client.fetch(GENERAL_CV_PAGE_QUERY)]);
  if(!page?._id || !page?._rev)throw fail('GENERAL_CV_PAGE_MISSING','Publish the CV site page before refreshing its PDF.',503);
  const sourceFingerprint=generalCvFingerprint(source,{publicUrl});
  const current=isCurrent(page,source,sourceFingerprint);
  if(!current)await assertNoDrafts(client,source,page);
  return {needed:!current,sourceFingerprint,...versionsFor(source),available:generalCvPageAvailable(page)};
}

function revisions(source,page) {
  const rows=new Map([[page._id,page._rev]]);
  const add=(id,rev)=>{
    if(!id || !rev)throw fail('GENERAL_CV_SOURCE_INVALID','CV source revisions are incomplete.',503);
    if(rows.has(id) && rows.get(id)!==rev)throw fail('GENERAL_CV_SOURCE_CHANGED','CV source revisions conflict. Refresh the source.',409);
    rows.set(id,rev);
  };
  add(page._id,source.revisions?.identity);
  add('application-cv-settings',source.revisions?.settings);
  for(const record of source.revisions?.records||[]){const colon=record.lastIndexOf(':');
    if(colon<1)throw fail('GENERAL_CV_SOURCE_INVALID','CV source revision records are malformed.',503);
    add(record.slice(0,colon),record.slice(colon+1));}
  for(const section of [...source.roles,...(source.education||[]),...(source.projects||[])])
    for(const evidence of section.evidence||[])add(evidence.sourceRef?.documentId,evidence.sourceRef?.revision);
  return [...rows].map(([id,rev])=>({id,rev}));
}

async function assertNoDrafts(client,source,page) {
  const ids=revisions(source,page).map(row=>`drafts.${row.id}`);
  if(await client.withConfig({perspective:'raw'}).fetch(DRAFT_QUERY,{ids}))
    throw fail('GENERAL_CV_DRAFT_EXISTS','Publish or discard pending CV source and page drafts before refreshing.',409);
}

export async function executeGeneralCvRefresh({expectedSourceFingerprint,publicUrl=GENERAL_CV_PUBLIC_URL,runId}={},
  {client=createStorageClient(),loadSource=loadApplicationCvSource,build=buildGeneralApplicationCv,
    render=renderApplicationCvPdf}={}) {
  const [source,page]=await Promise.all([loadSource(null,client),client.fetch(GENERAL_CV_PAGE_QUERY)]);
  if(!page?._id || !page?._rev)throw fail('GENERAL_CV_PAGE_MISSING','The CV site page is unavailable.',503);
  const sourceFingerprint=generalCvFingerprint(source,{publicUrl});
  if(expectedSourceFingerprint && expectedSourceFingerprint!==sourceFingerprint)
    return {outcome:'superseded',sourceFingerprint};
  await assertNoDrafts(client,source,page);
  if(isCurrent(page,source,sourceFingerprint))
    return {outcome:'reused',sourceFingerprint,pdfSha256:page.generalCv.pdfSha256,assetId:page.download.asset._ref};

  const {content,rendered:{pdfBytes,pdfSha256,layout}}=await renderGeneralApplicationCv(source,{publicUrl,build,render});
  const bytes=Buffer.from(pdfBytes||[]);
  if(bytes.length<20 || bytes.length>5_000_000 || bytes.subarray(0,5).toString()!=='%PDF-' ||
    !bytes.subarray(-1024).toString().includes('%%EOF') || digest(bytes)!==pdfSha256 || layout?.pageCount>(source.settings?.layout==='detailed'?source.settings.pages:1))
    throw fail('GENERAL_CV_PDF_INVALID','The rendered general CV PDF failed validation.',422);

  const [latestSource,latestPage]=await Promise.all([loadSource(null,client),client.fetch(GENERAL_CV_PAGE_QUERY)]);
  if(generalCvFingerprint(latestSource,{publicUrl})!==sourceFingerprint)
    return {outcome:'superseded',sourceFingerprint};
  if(latestPage?._rev!==page._rev)throw fail('GENERAL_CV_PAGE_CHANGED','The CV page changed during rendering. Retry against its latest revision.');
  await assertNoDrafts(client,latestSource,latestPage);
  const asset=await client.assets.upload('file',bytes,{contentType:'application/pdf',filename:'bernardo-raposo-cv.pdf'});
  if(!asset?._id)throw fail('GENERAL_CV_ASSET_FAILED','The rendered CV asset could not be saved.',503);
  await assertNoDrafts(client,latestSource,latestPage);
  const metadata={_type:'generalCv',content:json(content),sourceFingerprint,pdfSha256,pdfAssetId:asset._id,
    ...versionsFor(source),
    generatedAt:new Date().toISOString(),runId:runId||'',usage:json({estimatedAiCostMicros:0,inputTokens:0,outputTokens:0})};
  const tx=client.transaction().patch(page._id,p=>p.ifRevisionId(page._rev).set({
    download:{_type:'file',asset:{_type:'reference',_ref:asset._id}},generalCv:metadata}));
  for(const {id,rev} of revisions(latestSource,latestPage))if(id!==page._id)
    tx.patch(id,p=>p.ifRevisionId(rev));
  await tx.commit({visibility:'sync'});
  return {outcome:'published',sourceFingerprint,pdfSha256,assetId:asset._id,aiCostMicros:0};
}
