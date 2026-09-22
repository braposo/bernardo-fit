import {createStorageClient} from './client.js';
import * as codec from './codecs.js';
import {appendAudit,jobMutationEvents,auditEvent} from '../job-audit.js';

const conflict = (message='This record changed while saving. Please retry.',code='CONTENT_CHANGED') => Object.assign(new Error(message),{status:409,code});
const retryable = error => error.statusCode===409 || error.status===409 && error.code!=='SANITY_DRAFT_EXISTS';
const typeFor = {cover:'coverLetter',research:'companyResearch',brief:'interviewBrief'};
const projection = `{
  ..., "questions": *[_type == "applicationQuestion" && job._ref == ^._id && !defined(deletedAt) && pending != true] | order(order asc),
  "assessment": activeAssessment->, "report": activeReport->{_id,legacyId},
  "cover": activeCoverLetter->, "research": activeResearch->, "brief": activeBrief->,
  "coverCount": count(*[_type == "coverLetter" && job._ref == ^._id && !defined(deletedAt) && pending != true])
}`;
export function createRepository(client=createStorageClient()) {
  const audit=async(scope,id,events)=>{
    try {for(const event of events)await appendAudit(scope,id,event);}
    catch {console.warn('Content saved; operational audit logging is temporarily unavailable.');}
  };
  const fetch= (query,params={})=>client.fetch(query,params);
  const find = async (type,identity) => {
    const rows=await fetch('*[_type == $type && legacyId == $legacyId && (!defined($versionId) || versionId == $versionId) && (!defined($jobId) || job._ref == $jobId)][0...2]',{type,versionId:null,jobId:null,...identity});
    if(rows.length>1)throw new Error(`Duplicate Sanity identity for ${type}`);
    return rows[0] || null;
  };
  const noDrafts = async docs => {
    const ids=docs.filter(Boolean).map(d=>`drafts.${d._id}`);
    if(ids.length && (await client.withConfig({perspective:'raw'}).fetch('count(*[_id in $ids])',{ids}))) {
      throw conflict('Publish or discard the pending Studio draft before changing this record in the app.','SANITY_DRAFT_EXISTS');
    }
  };
  // A single registry guards identity allocation, while Sanity generates ordinary document IDs.
  // Read registry BEFORE identity lookup so concurrent creators cannot both succeed.
  const ensure = async (type,identity,fields={}) => {
    await client.createIfNotExists({_id:'fit-content-registry',_type:'contentRegistry',sequence:0});
    for(let attempt=0;attempt<12;attempt++) {
      const registry=await client.getDocument('fit-content-registry');
      const existing=await find(type,identity);
      if(existing)return existing;
      try {
        await client.transaction().patch(registry._id,p=>p.ifRevisionId(registry._rev).inc({sequence:1}))
          .create(codec.clean({_type:type,legacyId:identity.legacyId,...(identity.versionId?{versionId:identity.versionId}:{}),...(identity.jobId?{job:{_type:'reference',_ref:identity.jobId}}:{}),pending:true,...fields}))
          .commit({visibility:'sync'});
        return await find(type,identity);
      } catch(error) {if(!retryable(error))throw error;}
    }
    throw conflict();
  };
  const patch = (tx,doc,fields) => tx.patch(doc._id,p=>p.ifRevisionId(doc._rev).set(codec.clean(fields)));
  const guard = (tx,doc) => tx.patch(doc._id,p=>p.ifRevisionId(doc._rev));
  const rawJob = async id => (await fetch(`*[_type == "job" && legacyId == $id][0]${projection}`,{id}));
  const getJob = async id => {const doc=await rawJob(id);return doc?.pending ? null : codec.jobFrom(doc);};
  const all = async (type,extra='') => {
    const rows=[];
    let after='';
    while(true) {
      const page=await fetch(`*[_type == $type && pending != true && !defined(deletedAt) && _id > $after] | order(_id asc)[0...200]${extra}`,{type,after});
      rows.push(...page);if(page.length<200)break;after=page.at(-1)._id;
    }
    return rows;
  };
  const listJobs=async()=> (await all('job',projection)).map(codec.jobFrom).sort((a,b)=>String(b.receivedAt).localeCompare(String(a.receivedAt)));
  const reportDoc = id => fetch('*[_type == "fitReport" && legacyId == $id && current == true && !defined(deletedAt)][0]',{id});
  // Imported live reports predate the current discriminator; the migration source key is unambiguous.
  const currentReport = async id => await reportDoc(id) || await fetch('*[_type == "fitReport" && migration.sourceKey == $key && !defined(deletedAt)][0]',{key:`report:${id}:current`});
  const versionValues = (docs,active) => docs.map(d=>({vid:d.versionId,createdAt:d.generatedAt || '',model:d.model || '',report:codec.reportFrom(d),
    internal:d.internalAssessment?{...codec.strip(d.internalAssessment),breakdown:Object.fromEntries((d.internalAssessment.breakdown||[]).map(v=>[v.label,v.value]))}:null,
    versionInstructions:d.versionInstructions || '',active:active.activeVersionId ? active.activeVersionId===d.versionId : !!codec.state(d).active}));
  const reportVersions=async id => {
    const active=await currentReport(id);if(!active || active.pending)return [];
    const docs=await fetch('*[_type == "fitReport" && legacyId == $id && defined(versionId) && current != true && pending != true && !defined(deletedAt)] | order(generatedAt desc)',{id});
    return versionValues(docs,active);
  };
  const changeJob=async(id,mutate,options,recordOf)=>{
    for(let attempt=0;attempt<12;attempt++) {
      let current=await getJob(id);
      if(!current && !options.create)return null;
      if(options.expectedRevision!==undefined && options.expectedRevision!==(current?.revision??-1))throw conflict();
      const changed=mutate(current || {});if(changed===undefined)return current;
      let doc=current?.[codec.metadata];
      if(!doc) {await ensure('job',{legacyId:id});doc=await rawJob(id);if(!doc.pending)continue;}
      const observed=[doc,...doc.questions || [],doc.assessment].filter(Boolean);
      await noDrafts(observed);
      let tx=client.transaction();
      let auditNext=null;
      if(options.expectedReportRevision) {
        const r=await currentReport(options.expectedReportRevision.id);
        if(codec.reportRevision(r)!==options.expectedReportRevision.revision)throw conflict('The linked analysis changed while saving.','REPORT_CHANGED');
        if(r)tx=guard(tx,r);
      }
      if(changed===null) {
        tx=patch(tx,doc,{deletedAt:new Date().toISOString()});
        if(current?.fitReportId) {const r=await currentReport(current.fitReportId);if(r)tx=patch(tx,r,{dismissed:true});}
      } else {
        const next={...recordOf({...current,...changed},(current?.revision??-1)+1),id};
        auditNext=next;
        next.auditStartedAt=current?.auditStartedAt || new Date().toISOString();
        next.auditLegacy=current ? !current.auditStartedAt || !!current.auditLegacy : false;
        next.auditReportIds=[...new Set([...(current?.auditReportIds || []),current?.fitReportId,next.fitReportId].filter(Boolean))];
        const fields={...codec.jobFields(next),pending:false};
        for(const [field,kind,value] of [['activeCoverLetter','cover',next.coverLetterId],['activeResearch','research',next.researchId],['activeBrief','brief',next.briefId]]) {
          const artifact=value?await find(typeFor[kind],{legacyId:id,versionId:value,jobId:doc._id}):null;
          if(value && (!artifact || artifact.pending || artifact.deletedAt))throw conflict(`Cannot link missing ${kind} content.`);
          fields[field]=codec.reference(artifact);
        }
        const report=next.fitReportId?await currentReport(next.fitReportId):null;
        if(next.fitReportId && !report)throw conflict('Cannot link a missing fit report.');
        fields.activeReport=codec.reference(report);
        if(next.jevAssessment) {
          const assessment=doc.assessment || await ensure('fitAssessment',{legacyId:id,jobId:doc._id},{job:codec.reference(doc)});
          await noDrafts([assessment]);tx=patch(tx,assessment,{...codec.assessmentFields(next.jevAssessment,doc),pending:false});
          fields.activeAssessment=codec.reference(assessment);
        } else fields.activeAssessment=null;
        const questionIds=new Set();
        for(const [order,q] of (next.questions || []).entries()) {
          const question=(doc.questions || []).find(d=>d.legacyId===q.id) || await ensure('applicationQuestion',{legacyId:q.id,jobId:doc._id});
          await noDrafts([question]);questionIds.add(question._id);
          tx=patch(tx,question,{...codec.questionFields(q,doc,order),pending:false,deletedAt:null});
        }
        for(const q of doc.questions || [])if(!questionIds.has(q._id))tx=patch(tx,q,{deletedAt:new Date().toISOString()});
        tx=patch(tx,doc,fields);
      }
      try {await tx.commit({visibility:'sync'});await audit('job',id,jobMutationEvents(current,auditNext,(current?.revision??-1)+1));return changed===null?current:await getJob(id);}
      catch(error){if(!retryable(error) || options.expectedRevision!==undefined)throw error;}
    }
    throw conflict();
  };
  const changeReport=async(id,mutate,options={})=>{
    for(let attempt=0;attempt<12;attempt++) {
      let doc=await currentReport(id);
      const current=doc && !doc.pending?codec.reportFrom(doc):null;
      if(options.expectedRevision!==undefined && options.expectedRevision!==codec.reportRevision(doc))throw conflict('The analysis changed while work was running.','REPORT_CHANGED');
      if(!current && !options.create)return null;
      const historical=await fetch('*[_type == "fitReport" && legacyId == $id && defined(versionId) && current != true && pending != true && !defined(deletedAt)] | order(generatedAt desc)',{id});
      const versions=doc?versionValues(historical,doc):[];
      const next=mutate(current,versions);if(next===undefined)return null;
      if(!doc) {
        doc=await ensure('fitReport',{legacyId:id,versionId:'__current'},{current:true});
        if(!doc.pending)continue; // Another writer published while this attempt allocated its identity.
      }
      await noDrafts([doc,...historical]);
      let tx=client.transaction();
      if(!next.report) {
        tx=patch(tx,doc,{deletedAt:new Date().toISOString()});
        for(const v of historical)tx=patch(tx,v,{deletedAt:new Date().toISOString()});
      } else {
        for(const v of next.versions || []) {
          const existing=historical.find(d=>d.versionId===v.vid);
          if(existing) {tx=guard(tx,existing);continue;}
          const entry=await ensure('fitReport',{legacyId:id,versionId:v.vid});
          tx=patch(tx,entry,{...codec.reportFields(v.report),versionId:v.vid,versionInstructions:v.versionInstructions || '',generatedAt:v.createdAt,
            internalAssessment:v.internal?{...v.internal,breakdown:codec.keyed(Object.entries(v.internal.breakdown || {}).map(([label,value])=>({label,value})))}:null,
            active:false,current:false,pending:false});
        }
        tx=patch(tx,doc,{...codec.reportFields(next.report),publiclyShared:doc.publiclyShared ?? true,current:true,pending:false,active:true,activeVersionId:next.versions?.find(v=>v.active)?.vid || null});
      }
      try{await tx.commit({visibility:'sync'});await audit('report',id,[auditEvent(next.report?'document.published':'document.deleted',next.report?'Fit analysis published live':'Fit analysis deleted')]);return next.result;}
      catch(error){if(!retryable(error) || options.expectedRevision!==undefined)throw error;}
    }
    throw conflict();
  };
  const listReports=async()=> (await all('fitReport')).filter(d=>d.current || d.migration?.sourceKey===`report:${d.legacyId}:current`).map(d=>({id:d.legacyId,...codec.reportFrom(d)})).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  const artifacts=async(kind,jobId)=>{
    const job=await find('job',{legacyId:jobId});if(!job)return [];
    return fetch('*[_type == $type && job._ref == $job && pending != true && !defined(deletedAt)] | order(generatedAt desc)',{type:typeFor[kind],job:job._id});
  };
  const getArtifact=async(kind,jobId,id)=>{
    const job=await find('job',{legacyId:jobId});if(!job)return null;
    const doc=await find(typeFor[kind],{legacyId:jobId,versionId:id,jobId:job._id});
    return doc?.pending?null:codec.artifactFrom(doc,kind,jobId);
  };
  const saveArtifact=async(kind,jobId,id,value)=>{
    const job=await find('job',{legacyId:jobId});if(!job || job.deletedAt)throw conflict('Job no longer exists.');
    const doc=await ensure(typeFor[kind],{legacyId:jobId,versionId:id,jobId:job._id});
    if(!doc.pending)return codec.artifactFrom(doc,kind,jobId);
    await noDrafts([doc]);
    try{await patch(client.transaction(),doc,{...codec.artifactFields(kind,job,id,value),pending:false}).commit({visibility:'sync'});}
    catch(error){if(!retryable(error))throw error;}
    return getArtifact(kind,jobId,id);
  };
  const deleteArtifacts=async(kind,jobId)=>{
    const docs=await artifacts(kind,jobId);await noDrafts(docs);
    let tx=client.transaction();for(const doc of docs)tx=patch(tx,doc,{deletedAt:new Date().toISOString()});
    if(docs.length)await tx.commit({visibility:'sync'});return docs.length;
  };
  return {getJob,listJobs,changeJob,changeReport,listReports,getReport:async id=>codec.reportFrom(await currentReport(id)),
    getSharedReport:async id=>{const doc=await currentReport(id);return doc?.publiclyShared===false?null:codec.reportFrom(doc);},
    getReportRevision:async id=>codec.reportRevision(await currentReport(id)),listReportVersions:reportVersions,
    getArtifact,saveArtifact,listArtifacts:async(kind,id)=>(await artifacts(kind,id)).map(d=>codec.artifactFrom(d,kind,id)),deleteArtifacts,
    dismissedReports:async()=>new Set((await all('fitReport')).filter(d=>d.dismissed).map(d=>d.legacyId)),
    undismissReport:async id=>{const doc=await currentReport(id);if(doc)await patch(client.transaction(),doc,{dismissed:false}).commit({visibility:'sync'});return !!doc;},
  };
}
let instance;
export const repository = () => instance ||= createRepository();
