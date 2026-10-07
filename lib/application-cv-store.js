import {createHash,randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createContentClient,createStorageClient,sanityStorageEnabled} from './sanity/client.js';
import {publicReport} from './report.js';
import {safeApplicationCvContactHref} from './application-cv-contacts.js';
import {publicApplicationCvLinks} from './application-cv-links.js';

const conflict=(message='The application CV changed while saving.',code='APPLICATION_CV_CHANGED')=>Object.assign(new Error(message),{status:409,code});
const missing=()=>Object.assign(new Error('Application CV not found.'),{status:404,code:'APPLICATION_CV_NOT_FOUND'});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const ref=id=>({_type:'reference',_ref:id});
const parse=value=>value?.payload?JSON.parse(value.payload):null;
const wrap=value=>({_type:'applicationCvJson',payload:JSON.stringify(value??null)});
const validId=value=>typeof value==='string' && /^[a-zA-Z0-9_-]{4,128}$/.test(value);
const retryable=error=>error?.statusCode===409 || error?.status===409;
const pdfBytesOf=version=>version.pdfBuffer||version.pdfBytes;
const isPdf=bytes=>bytes?.length>=20 && bytes.subarray(0,5).toString()==='%PDF-' && bytes.subarray(-1024).toString().includes('%%EOF');
const versionFrom=doc=>doc&&({id:doc.requestId,jobId:doc.jobId,createdAt:doc.createdAt,fingerprint:doc.fingerprint,
  jobFingerprint:doc.jobFingerprint||null,sourceFingerprint:doc.sourceFingerprint||null,
  versionInstructions:doc.versionInstructions||'',templateVersion:doc.templateVersion||'',rendererVersion:doc.rendererVersion||'',
  verification:parse(doc.verification),
  reportSnapshot:parse(doc.reportSnapshot),content:parse(doc.content),sourceSnapshot:parse(doc.sourceSnapshot),
  validation:parse(doc.validation),pdfAsset:doc.pdf, pdfSha256:doc.pdfSha256,model:doc.model,usage:parse(doc.usage),
  pdfUrl:doc.pdfUrl||null});
const bindingFrom=doc=>doc&&({jobId:doc.jobId,publicId:doc.publicId,currentVersionId:doc.currentVersion?.requestId||null,
  submittedVersionId:doc.submittedVersion?.requestId||null,run:doc.run||null,
  currentVersion:doc.currentVersion?versionSummary(doc.currentVersion):null});
const versionSummary=doc=>doc&&({id:doc.requestId,createdAt:doc.createdAt,fingerprint:doc.fingerprint,
  versionInstructions:doc.versionInstructions||'',
  jobFingerprint:doc.jobFingerprint||null,sourceFingerprint:doc.sourceFingerprint||null,
  verification:parse(doc.verification),
  model:doc.model,validation:parse(doc.validation),pdfSha256:doc.pdfSha256,
  reportId:parse(doc.reportSnapshot)?.id||null});
const savedVersionSummary=doc=>{
  const validation=parse(doc?.validation)||doc?.validation;
  if(validation?.status!=='valid' || !doc?.pdfSha256 || !(doc.pdfAssetRef || doc.pdfAsset?._ref))return null;
  if(doc.bindId && !applicationCvPdfUrl({validation,pdfSha256:doc.pdfSha256,pdfUrl:doc.pdfUrl},{download:false}))return null;
  return {id:doc.requestId||doc.id,createdAt:doc.createdAt||'',model:doc.model||'',
    validationStatus:'valid',hasPdf:true};
};

export function publicCvVersion(version) {
  if(!version?.content || version.validation?.status!=='valid' || !version.pdfSha256) return null;
  const content=version.content;
  const strings=value=>Array.isArray(value)?value.filter(item=>typeof item==='string'):[];
  // Two-page fields are copied only when present, so one-page output is unchanged.
  const detail=entry=>({...(typeof entry?.depth==='string'?{depth:entry.depth}:{}),...(typeof entry?.scope==='string'?{scope:entry.scope}:{}),
    ...(Array.isArray(entry?.responsibilities)?{responsibilities:strings(entry.responsibilities)}:{}),...(Array.isArray(entry?.highlights)?{highlights:strings(entry.highlights)}:{}),
    ...(Array.isArray(entry?.stack)?{stack:strings(entry.stack)}:{})});
  const section=entry=>({title:String(entry?.title||''),company:String(entry?.company||''),dates:String(entry?.dates||''),
    location:String(entry?.location||''),links:publicApplicationCvLinks(entry?.links),bullets:Array.isArray(entry?.bullets)?entry.bullets.map(b=>({text:String(typeof b==='string'?b:b?.text||'')})):[],...detail(entry)});
  const contacts=Array.isArray(content.identity?.contacts)?content.identity.contacts.filter(c=>typeof c?.label==='string' && safeApplicationCvContactHref(c?.href))
    .map(c=>({label:c.label,href:safeApplicationCvContactHref(c.href)})):[];
  const detailed=content.layout==='detailed'?{layout:'detailed',
    profile:{paragraphs:strings(content.profile?.paragraphs),skills:Array.isArray(content.profile?.skills)?content.profile.skills
      .map(group=>({label:String(group?.label||''),items:strings(group?.items)})):[]},
    featured:Array.isArray(content.featured)?content.featured.map(section):[],contributionsIntro:String(content.contributionsIntro||''),
    earlier:Array.isArray(content.earlier)?content.earlier.map(role=>({title:String(role?.title||''),company:String(role?.company||''),
      dates:String(role?.dates||''),location:String(role?.location||''),text:String(role?.text||'')})):[]}:{};
  return {createdAt:version.createdAt,content:{identity:{name:String(content.identity?.name||''),
      headline:String(content.identity?.headline||''),contacts},summary:String(content.summary||''),
      experience:Array.isArray(content.experience)?content.experience.map(section):[],
      education:Array.isArray(content.education)?content.education.map(section):[],
      projects:Array.isArray(content.projects)?content.projects.map(section):[],
      skills:Array.isArray(content.skills)?content.skills.map(String):[],...detailed},pdfSha256:version.pdfSha256};
}

export function applicationCvFilename(version) {
  const parts = [version?.content?.identity?.name, version?.reportSnapshot?.report?.company]
    .filter(Boolean).map(value => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)).filter(Boolean);
  return parts.length ? `${parts.join('-')}-CV.pdf` : 'application-cv.pdf';
}

export function applicationCvPdfUrl(version,{download=true}={}) {
  if(version?.validation?.status!=='valid' || !version.pdfSha256 || !version.pdfUrl)return null;
  let url;try{url=new URL(version.pdfUrl);}catch{return null;}
  if(url.origin!=='https://cdn.sanity.io' || !url.pathname.startsWith('/files/quli96gc/production/') || !url.pathname.endsWith('.pdf'))return null;
  url.search='';url.hash='';
  if(download)url.searchParams.set('dl',applicationCvFilename(version));
  return url.href;
}

export function createApplicationCvStore(client=createStorageClient()) {
  const fetch=(query,params={})=>client.fetch(query,params);
  const jobDoc=jobId=>fetch('*[_type == "job" && legacyId == $jobId && !defined(deletedAt) && pending != true][0]{_id,_rev,legacyId,stage,archived}',{jobId});
  const binding=jobId=>fetch('*[_type == "applicationCvBinding" && jobId == $jobId][0]{...,"currentVersion":currentVersion->{_id,requestId,createdAt,fingerprint,jobFingerprint,sourceFingerprint,model,validation,verification,pdfSha256,reportSnapshot},"submittedVersion":submittedVersion->{requestId}}',{jobId});
  const byPublicId=publicId=>fetch('*[_type == "applicationCvBinding" && publicId == $publicId][0]{_id,_rev,jobId,publicId,"job":job->{_id,pending,deletedAt},"currentVersion":currentVersion->{_id,requestId,createdAt,fingerprint,model,content,reportSnapshot,validation,pdfSha256,"pdfUrl":pdf.asset->url},"submittedVersion":submittedVersion->{requestId}}',{publicId});
  const versionDoc=(bindId,versionId)=>fetch('*[_type == "applicationCvVersion" && binding._ref == $bindId && requestId == $versionId][0]{...,"pdfUrl":pdf.asset->url}',{bindId,versionId});
  const checkJob=async jobId=>{const doc=await jobDoc(jobId);if(!doc)throw missing();return doc;};
  const checkDraft=async doc=>{
    if(await client.withConfig({perspective:'raw'}).fetch('count(*[_id == $draft])',{draft:`drafts.${doc._id}`}))
      throw conflict('Publish or discard the pending Studio draft first.','SANITY_DRAFT_EXISTS');
  };
  const ensure=async job=>{
    const jobId=typeof job==='string'?job:job?.id;
    if(!validId(jobId))throw missing();
    await client.createIfNotExists({_id:'application-cv-registry',_type:'contentRegistry',sequence:0});
    for(let attempt=0;attempt<10;attempt++){
      const [parent,registry,existing]=await Promise.all([checkJob(jobId),client.getDocument('application-cv-registry'),binding(jobId)]);
      if(existing)return bindingFrom(existing);
      const publicId=randomUUID().replaceAll('-','');
      try{
        await client.transaction().patch(registry._id,p=>p.ifRevisionId(registry._rev).inc({sequence:1}))
          .create({_type:'applicationCvBinding',job:ref(parent._id),jobId,publicId,versionSequence:0})
          .commit({visibility:'sync'});
        const created=await binding(jobId);if(created)return bindingFrom(created);
      }catch(error){if(!retryable(error))throw error;}
    }
    throw conflict();
  };
  const get=async jobId=>bindingFrom(await binding(jobId));
  const summaries=async jobIds=>{
    const ids=[...new Set(jobIds.filter(validId))];if(!ids.length)return {};
    const docs=await fetch('*[_type == "applicationCvBinding" && jobId in $ids]{_id,jobId,publicId,run,"currentVersion":currentVersion->{requestId,createdAt,fingerprint,jobFingerprint,sourceFingerprint,model,validation,verification,pdfSha256,reportSnapshot},"submittedVersion":submittedVersion->{requestId}}',{ids});
    const bindIds=docs.map(doc=>doc._id);
    const rows=bindIds.length?await fetch('*[_type == "applicationCvVersion" && binding._ref in $bindIds && defined(pdfSha256) && defined(pdf.asset->url)] | order(createdAt desc){"bindId":binding._ref,requestId,createdAt,model,validation,pdfSha256,"pdfAssetRef":pdf.asset._ref,"pdfUrl":pdf.asset->url}',{bindIds}):[];
    const latest=new Map();
    for(const row of rows){if(!latest.has(row.bindId)){const saved=savedVersionSummary(row);if(saved)latest.set(row.bindId,saved);}}
    return Object.fromEntries(docs.map(doc=>[doc.jobId,{...bindingFrom(doc),latestVersion:latest.get(doc._id)||null}]));
  };
  const claim=async(job,pending)=>{
    const jobId=typeof job==='string'?job:job?.id;
    if(!validId(pending?.requestId))throw conflict('A stable request ID is required.');
    await ensure(job);
    for(let attempt=0;attempt<10;attempt++){
      const [parent,doc]=await Promise.all([checkJob(jobId),binding(jobId)]);
      if(parent.archived)throw conflict('Archived jobs cannot start a new CV.','APPLICATION_CV_ARCHIVED');
      if(doc.run?.requestId===pending.requestId)return bindingFrom(doc);
      if(doc.run && ['dispatching','queued','running'].includes(doc.run.status)
        && doc.run.fingerprint===pending.fingerprint && doc.run.model===pending.model)return bindingFrom(doc);
      if(doc.run && !['failed','completed','cancelled','needs_review','superseded'].includes(doc.run.status))throw conflict('An application CV is already running.','APPLICATION_CV_BUSY');
      await checkDraft(doc);
      const run={...pending,status:pending.status||'queued',updatedAt:new Date().toISOString()};
      try{await client.transaction().patch(doc._id,p=>p.ifRevisionId(doc._rev).set({run})).commit({visibility:'sync'});return get(jobId);}
      catch(error){if(!retryable(error))throw error;}
    }
    throw conflict();
  };
  const update=async(jobId,requestId,patch)=>{
    const doc=await binding(jobId);if(!doc)throw missing();
    if(doc.run?.requestId!==requestId)throw conflict('A newer CV request owns this job.','APPLICATION_CV_RUN_REPLACED');
    if(patch.status==='queued' && !['dispatching','queued'].includes(doc.run.status))patch={runId:patch.runId};
    if(['completed','needs_review','failed','cancelled','superseded'].includes(doc.run.status) && patch.status && patch.status!==doc.run.status)
      throw conflict('This CV request already finished.','APPLICATION_CV_RUN_FINISHED');
    await checkDraft(doc);
    const run={...doc.run,...patch,requestId,updatedAt:new Date().toISOString()};
    await client.transaction().patch(doc._id,p=>p.ifRevisionId(doc._rev).set({run})).commit({visibility:'sync'});
    return run;
  };
  const saveAny=async(jobId,version,reviewDraft=false)=>{
    if(!validId(version?.id) || !validId(jobId) || !version.fingerprint || !version.content || !version.reportSnapshot || !version.sourceSnapshot || !version.validation)
      throw conflict('A complete CV version is required.','APPLICATION_CV_VERSION_INVALID');
    const doc=await binding(jobId);if(!doc)throw missing();
    const existing=await versionDoc(doc._id,version.id);if(existing)return versionFrom(existing);
    if(doc.run?.requestId!==version.id)throw conflict('A newer CV request owns this job.','APPLICATION_CV_RUN_REPLACED');
    if(reviewDraft && version.validation?.status!=='needs_review')throw conflict('A review draft requires review issues.','APPLICATION_CV_VERSION_INVALID');
    const bytes=reviewDraft?null:Buffer.from(pdfBytesOf(version)||[]);
    if(!reviewDraft && (!isPdf(bytes) || bytes.length>5_000_000))throw conflict('A valid PDF under 5 MB is required.','APPLICATION_CV_PDF_INVALID');
    const digest=bytes?sha(bytes):null;
    if(bytes && version.pdfSha256 && version.pdfSha256!==digest)throw conflict('CV PDF checksum mismatch.','APPLICATION_CV_PDF_INVALID');
    const asset=bytes?await client.assets.upload('file',bytes,{contentType:'application/pdf',filename:`application-cv-${version.id}.pdf`}):null;
    const parent=await checkJob(jobId);
    const row={_type:'applicationCvVersion',binding:ref(doc._id),job:ref(parent._id),jobId,requestId:version.id,
      createdAt:version.createdAt||new Date().toISOString(),fingerprint:version.fingerprint,
      jobFingerprint:version.jobFingerprint||null,sourceFingerprint:version.sourceFingerprint||version.sourceSnapshot?.fingerprint||null,
      versionInstructions:version.versionInstructions||'',templateVersion:version.templateVersion||'',rendererVersion:version.rendererVersion||'',
      verification:wrap(version.verification||null),reportSnapshot:wrap(version.reportSnapshot),content:wrap(version.content),sourceSnapshot:wrap(version.sourceSnapshot),
      validation:wrap(version.validation),usage:wrap(version.usage||null),...(asset?{pdf:{_type:'file',asset:ref(asset._id)},pdfSha256:digest}:{}),model:version.model||''};
    // Binding revision serializes same-job version creation without assigning ordinary document IDs.
    try{
      await client.transaction().patch(doc._id,p=>p.ifRevisionId(doc._rev).inc({versionSequence:1})).create(row).commit({visibility:'sync'});
    }catch(error){
      if(!retryable(error))throw error;
      const winner=await versionDoc(doc._id,version.id);if(winner)return versionFrom(winner);
      throw conflict();
    }
    return versionFrom(await versionDoc(doc._id,version.id));
  };
  const save=(jobId,version)=>saveAny(jobId,version,false);
  const saveReview=(jobId,version)=>saveAny(jobId,version,true);
  const getVersion=async(jobId,versionId)=>{
    const doc=await binding(jobId);return doc?versionFrom(await versionDoc(doc._id,versionId)):null;
  };
  const versions=async jobId=>{
    const doc=await binding(jobId);if(!doc)return [];
    const rows=await fetch('*[_type == "applicationCvVersion" && binding._ref == $bindId] | order(createdAt desc){requestId,createdAt,fingerprint,jobFingerprint,sourceFingerprint,model,validation,verification,pdfSha256,reportSnapshot,versionInstructions}',{bindId:doc._id});
    return rows.map(row=>({...versionSummary(row),active:doc.currentVersion?.requestId===row.requestId,submitted:doc.submittedVersion?.requestId===row.requestId}));
  };
  const publish=async(jobId,versionId,{expectedRequestId,expectedFingerprint,allowAfterSubmission=false,historical=false}={})=>{
    const [parent,doc]=await Promise.all([checkJob(jobId),binding(jobId)]);if(!doc)throw missing();
    if(parent.archived)throw conflict('Archived jobs cannot publish a CV.','APPLICATION_CV_ARCHIVED');
    const version=await versionDoc(doc._id,versionId);if(!version)throw missing();
    if(historical && !['completed','needs_review','failed','cancelled','superseded'].includes(doc.run?.status))
      throw conflict('Wait for the current CV run before choosing a historical version.','APPLICATION_CV_BUSY');
    if(!expectedRequestId || !expectedFingerprint || doc.run?.requestId!==expectedRequestId
      || !historical && (version.requestId!==expectedRequestId || doc.run.fingerprint!==expectedFingerprint)
      || version.fingerprint!==expectedFingerprint)
      throw conflict('CV source or request changed before publication.','APPLICATION_CV_STALE');
    if(!allowAfterSubmission && (doc.submittedVersion || parent.stage==='applied' || parent.stage==='interviewing' || parent.stage==='offer'))
      throw conflict('This application has already been submitted.','APPLICATION_CV_SUBMITTED');
    if(parse(version.validation)?.status!=='valid' || !version.pdf?.asset?._ref || !version.pdfSha256)
      throw conflict('Only a validated CV PDF can be published.','APPLICATION_CV_PDF_INVALID');
    await checkDraft(doc);
    await client.transaction().patch(parent._id,p=>p.ifRevisionId(parent._rev))
      .patch(doc._id,p=>p.ifRevisionId(doc._rev).set({currentVersion:ref(version._id),
      ...(!historical?{run:{...doc.run,status:'completed',phase:'completed',updatedAt:new Date().toISOString()}}:{})})).commit({visibility:'sync'});
    return get(jobId);
  };
  const submitted=async(jobId,versionId)=>{
    const doc=await binding(jobId);if(!doc?.currentVersion)throw missing();
    const selected=versionId?await versionDoc(doc._id,versionId):await versionDoc(doc._id,doc.currentVersion.requestId);
    if(!selected || selected._id!==doc.currentVersion._id)throw conflict('Only the current CV can be submitted.');
    if(doc.submittedVersion?.requestId && doc.submittedVersion.requestId!==selected.requestId)
      throw conflict('A submitted CV is already pinned.','APPLICATION_CV_SUBMITTED');
    if(doc.submittedVersion?.requestId===selected.requestId)return get(jobId);
    await checkDraft(doc);
    await client.transaction().patch(doc._id,p=>p.ifRevisionId(doc._rev).set({submittedVersion:ref(selected._id)})).commit({visibility:'sync'});
    return get(jobId);
  };
  const publicGet=async publicId=>{
    if(!validId(publicId))return null;
    const doc=await byPublicId(publicId);if(!doc?.currentVersion||!doc.job?._id||doc.job.pending||doc.job.deletedAt)return null;
    const version=versionFrom(doc.currentVersion),publicVersion=publicCvVersion(version);
    if(!publicVersion || !applicationCvPdfUrl(version,{download:false}))return null;
    const report=version.reportSnapshot?.report;
    return {publicId:doc.publicId,version:publicVersion,report:report?publicReport(report):null,
      pdfUrl:applicationCvPdfUrl(version,{download:false}),submitted:doc.submittedVersion?.requestId===version.id};
  };
  // Older share links address the job's fit report; send them to its live application page when one exists.
  const publicIdForReport=async reportId=>{
    if(typeof reportId!=='string' || !reportId)return null;
    const publicId=await fetch('*[_type == "applicationCvBinding" && defined(currentVersion) && job->activeReport->legacyId == $reportId][0].publicId',{reportId});
    return publicId && await publicGet(publicId) ? publicId : null;
  };
  return {ensureApplicationCv:ensure,getApplicationCv:get,getApplicationCvSummaries:summaries,
    claimApplicationCvRun:claim,updateApplicationCvRun:update,saveApplicationCvVersion:save,saveApplicationCvReviewDraft:saveReview,
    getApplicationCvVersion:getVersion,listApplicationCvVersions:versions,publishApplicationCvVersion:publish,
    markApplicationCvSubmitted:submitted,getPublicApplicationCv:publicGet,getPublicApplicationIdForReport:publicIdForReport};
}
// Explicit offline adapter for tests. Hosted entry points never select it.
export function createMemoryApplicationCvStore({jobExists=()=>true}={}) {
  const states=new Map(),versionRows=new Map();
  const clone=value=>value==null?value:structuredClone(value);
  const state=jobId=>states.get(jobId)||null;
  const versionKey=(jobId,id)=>`${jobId}:${id}`;
  const ensure=async job=>{
    const jobId=typeof job==='string'?job:job?.id;
    if(!validId(jobId)||!jobExists(jobId))throw missing();
    if(!state(jobId))states.set(jobId,{jobId,publicId:randomUUID().replaceAll('-',''),currentVersionId:null,submittedVersionId:null,run:null});
    return clone(state(jobId));
  };
  const get=async jobId=>clone(state(jobId));
  const summaries=async jobIds=>Object.fromEntries((await Promise.all(jobIds.map(get))).filter(Boolean).map(s=>{
    const latest=[...versionRows.values()].filter(v=>v.jobId===s.jobId)
      .sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))
      .map(savedVersionSummary).find(Boolean)||null;
    return [s.jobId,{...s,latestVersion:latest}];
  }));
  const claim=async(job,pending)=>{
    const s=await ensure(job);if(!validId(pending?.requestId))throw conflict();
    if(s.run?.requestId===pending.requestId)return s;
    if(s.run&&['dispatching','queued','running'].includes(s.run.status)
      && s.run.fingerprint===pending.fingerprint && s.run.model===pending.model)return s;
    if(s.run&&!['failed','completed','cancelled','needs_review','superseded'].includes(s.run.status))throw conflict('An application CV is already running.','APPLICATION_CV_BUSY');
    s.run={...pending,status:pending.status||'queued',updatedAt:new Date().toISOString()};states.set(s.jobId,s);return clone(s);
  };
  const update=async(jobId,requestId,patch)=>{
    const s=state(jobId);if(!s)throw missing();if(s.run?.requestId!==requestId)throw conflict('A newer CV request owns this job.','APPLICATION_CV_RUN_REPLACED');
    if(patch.status==='queued'&&!['dispatching','queued'].includes(s.run.status))patch={runId:patch.runId};
    if(['completed','needs_review','failed','cancelled','superseded'].includes(s.run.status)&&patch.status&&patch.status!==s.run.status)throw conflict('This CV request already finished.','APPLICATION_CV_RUN_FINISHED');
    s.run={...s.run,...patch,requestId,updatedAt:new Date().toISOString()};return clone(s.run);
  };
  const saveAny=async(jobId,value,review)=>{
    const s=state(jobId);if(!s)throw missing();const key=versionKey(jobId,value.id);
    if(versionRows.has(key))return clone(versionRows.get(key));
    if(s.run?.requestId!==value.id)throw conflict('A newer CV request owns this job.','APPLICATION_CV_RUN_REPLACED');
    if(review&&value.validation?.status!=='needs_review')throw conflict('A review draft requires review issues.');
    const bytes=review?null:Buffer.from(pdfBytesOf(value)||[]);
    if(!review&&(!isPdf(bytes)||bytes.length>5_000_000))throw conflict('A valid PDF under 5 MB is required.','APPLICATION_CV_PDF_INVALID');
    const digest=bytes?sha(bytes):null;
    if(bytes&&value.pdfSha256&&value.pdfSha256!==digest)throw conflict('CV PDF checksum mismatch.','APPLICATION_CV_PDF_INVALID');
    const {_pdfBuffer,_pdfBytes,...rest}=value;
    const saved={...rest,jobId,pdfSha256:digest,pdfAsset:bytes?{_ref:`test-asset-${value.id}`}:null};
    delete saved.pdfBuffer;delete saved.pdfBytes;
    versionRows.set(key,clone(saved));return clone(saved);
  };
  const getVersion=async(jobId,id)=>clone(versionRows.get(versionKey(jobId,id))||null);
  const versions=async jobId=>[...versionRows.values()].filter(v=>v.jobId===jobId).map(v=>({id:v.id,createdAt:v.createdAt,fingerprint:v.fingerprint,
    versionInstructions:v.versionInstructions||'',
    jobFingerprint:v.jobFingerprint||null,sourceFingerprint:v.sourceFingerprint||v.sourceSnapshot?.fingerprint||null,
    model:v.model,validation:v.validation,verification:v.verification||null,pdfSha256:v.pdfSha256,reportId:v.reportSnapshot?.id||null,
    active:state(jobId)?.currentVersionId===v.id,submitted:state(jobId)?.submittedVersionId===v.id}));
  const publish=async(jobId,id,{expectedRequestId,expectedFingerprint,allowAfterSubmission=false,historical=false}={})=>{
    const s=state(jobId),v=await getVersion(jobId,id);if(!s||!v)throw missing();
    if(historical&&!['completed','needs_review','failed','cancelled','superseded'].includes(s.run?.status))throw conflict('Wait for the current CV run before choosing a historical version.','APPLICATION_CV_BUSY');
    if(!expectedRequestId||!expectedFingerprint||s.run?.requestId!==expectedRequestId||!historical&&(s.run.fingerprint!==expectedFingerprint||v.id!==expectedRequestId)||v.fingerprint!==expectedFingerprint)throw conflict('CV source or request changed before publication.','APPLICATION_CV_STALE');
    if(s.submittedVersionId&&!allowAfterSubmission)throw conflict('This application has already been submitted.','APPLICATION_CV_SUBMITTED');
    if(v.validation?.status!=='valid'||!v.pdfAsset||!v.pdfSha256)throw conflict('Only a validated CV PDF can be published.','APPLICATION_CV_PDF_INVALID');
    s.currentVersionId=id;s.currentVersion={id:v.id,createdAt:v.createdAt,fingerprint:v.fingerprint,jobFingerprint:v.jobFingerprint||null,sourceFingerprint:v.sourceFingerprint||v.sourceSnapshot?.fingerprint||null,
      model:v.model,validation:v.validation,verification:v.verification||null,pdfSha256:v.pdfSha256,reportId:v.reportSnapshot?.id||null};
    if(!historical)s.run={...s.run,status:'completed',phase:'completed',updatedAt:new Date().toISOString()};return clone(s);
  };
  const submitted=async(jobId,id)=>{
    const s=state(jobId);if(!s?.currentVersionId)throw missing();if(id&&id!==s.currentVersionId)throw conflict('Only the current CV can be submitted.');
    if(s.submittedVersionId&&s.submittedVersionId!==s.currentVersionId)throw conflict('A submitted CV is already pinned.');
    s.submittedVersionId=s.currentVersionId;return clone(s);
  };
  const publicGet=async publicId=>{
    const s=[...states.values()].find(s=>s.publicId===publicId);if(!s?.currentVersionId||!jobExists(s.jobId))return null;
    const v=await getVersion(s.jobId,s.currentVersionId),version=publicCvVersion(v);if(!version)return null;
    return {publicId,version,report:publicReport(v.reportSnapshot?.report),pdfUrl:v.pdfUrl||null,submitted:s.submittedVersionId===v.id};
  };
  const publicIdForReport=async reportId=>{
    for(const s of states.values()){
      if(!s.currentVersionId)continue;
      const v=await getVersion(s.jobId,s.currentVersionId);
      if(v?.reportSnapshot?.id===reportId && await publicGet(s.publicId))return s.publicId;
    }
    return null;
  };
  return {ensureApplicationCv:ensure,getApplicationCv:get,getApplicationCvSummaries:summaries,claimApplicationCvRun:claim,
    updateApplicationCvRun:update,saveApplicationCvVersion:(jobId,v)=>saveAny(jobId,v,false),
    saveApplicationCvReviewDraft:(jobId,v)=>saveAny(jobId,v,true),getApplicationCvVersion:getVersion,
    listApplicationCvVersions:versions,publishApplicationCvVersion:publish,markApplicationCvSubmitted:submitted,getPublicApplicationCv:publicGet,
    getPublicApplicationIdForReport:publicIdForReport};
}
let instance,readInstance;
const testContext=new AsyncLocalStorage();
export const withApplicationCvStore=(injected,run)=>testContext.run(injected,run);
const store=()=>testContext.getStore() || (instance ||= createApplicationCvStore());
const readStore=()=>testContext.getStore() || (readInstance ||= createApplicationCvStore(createContentClient()));
export const ensureApplicationCv=(...args)=>store().ensureApplicationCv(...args);
export const getApplicationCv=(...args)=>!testContext.getStore()&&!sanityStorageEnabled()?Promise.resolve(null):readStore().getApplicationCv(...args);
export const getApplicationCvSummaries=(...args)=>!testContext.getStore()&&!sanityStorageEnabled()?Promise.resolve({}):readStore().getApplicationCvSummaries(...args);
export const claimApplicationCvRun=(...args)=>store().claimApplicationCvRun(...args);
export const updateApplicationCvRun=(...args)=>store().updateApplicationCvRun(...args);
export const saveApplicationCvVersion=(...args)=>store().saveApplicationCvVersion(...args);
export const saveApplicationCvReviewDraft=(...args)=>store().saveApplicationCvReviewDraft(...args);
export const getApplicationCvVersion=(...args)=>readStore().getApplicationCvVersion(...args);
export const listApplicationCvVersions=(...args)=>readStore().listApplicationCvVersions(...args);
export const publishApplicationCvVersion=(...args)=>store().publishApplicationCvVersion(...args);
export const markApplicationCvSubmitted=(...args)=>store().markApplicationCvSubmitted(...args);
export const getPublicApplicationCv=(...args)=>readStore().getPublicApplicationCv(...args);
export const getPublicApplicationIdForReport=(...args)=>!testContext.getStore()&&!sanityStorageEnabled()?Promise.resolve(null):readStore().getPublicApplicationIdForReport(...args);
