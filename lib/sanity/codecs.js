import {createHash} from 'node:crypto';
import {parseDocument} from 'htmlparser2';

export const metadata = Symbol('sanitySnapshot');
export const revision = docs => parseInt(createHash('sha256').update(docs.filter(Boolean).map(d=>`${d._id}:${d._rev}`).sort().join('|')).digest('hex').slice(0,12),16);
export const clean = value => Array.isArray(value) ? value.map(clean) : value && typeof value==='object'
  ? Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,clean(v)])) : value;
export const keyed = values => (values || []).map((v,i)=>({_key:v._key || `item${i}`,...v}));
export const strip = value => Array.isArray(value) ? value.map(strip) : value && typeof value==='object'
  ? Object.fromEntries(Object.entries(value).filter(([k])=>!k.startsWith('_')).map(([k,v])=>[k,strip(v)])) : value;
const parse = value => {try{return JSON.parse(value || '{}');}catch{return {};}};
export const state = doc => ({...parse(doc?.sourcePayload),...parse(doc?.appState)});
export const reference = doc => doc ? {_type:'reference',_ref:doc._id} : null;
const probabilityArray = value => keyed(Object.entries(value || {}).map(([label,value])=>({label,value})));
const probabilityObject = value => Object.fromEntries((value || []).map(v=>[v.label,v.value]));
export function plainText(blocks) {
  return (blocks || []).map(b=>(b.children || []).map(s=>s.text || '').join('')).join('\n\n');
}
export function paragraphsToBody(paragraphs) {
  return (paragraphs || []).map((p,i)=>{
    const block={_type:'block',_key:`p${i}`,style:'normal',markDefs:[],children:[]};
    const visit=(node,marks=[])=>{
      if(node.type==='text') {block.children.push({_type:'span',_key:`s${block.children.length}`,text:node.data,marks});return;}
      if(['script','style'].includes(node.name))return;
      let next=marks;
      if(['strong','b','em','i'].includes(node.name) || node.name==='span' && node.attribs?.class==='em')next=[...marks,node.name==='strong'||node.name==='b'?'strong':'em'];
      if(node.name==='a' && /^(https?:\/\/|mailto:)/i.test(node.attribs?.href || '')) {
        const key=`link${block.markDefs.length}`;block.markDefs.push({_key:key,_type:'link',href:node.attribs.href});next=[...marks,key];
      }
      if(node.name==='br')block.children.push({_type:'span',_key:`s${block.children.length}`,text:'\n',marks:[]});
      (node.children || []).forEach(child=>visit(child,next));
    };
    const escaped=String(p.text || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/\[\[([\s\S]*?)\]\]/g,'<em>$1</em>');
    parseDocument(p.html ?? escaped).children.forEach(node=>visit(node));
    return block;
  });
}
export function bodyToParagraphs(blocks,flags=[]) {
  const escape=value=>String(value || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  return (blocks || []).map((b,i)=>({lead:flags[i]?.lead ?? i===0,fit:!!flags[i]?.fit,html:(b.children || []).map(s=>{
    let text=escape(s.text).replaceAll('\n','<br>');
    for(const mark of s.marks || []) {
      if(['strong','em'].includes(mark))text=`<${mark}>${text}</${mark}>`;
      const link=(b.markDefs || []).find(d=>d._key===mark);
      if(link && /^(https?:\/\/|mailto:)/i.test(link.href || ''))text=`<a href="${escape(link.href)}">${text}</a>`;
    }
    return text;
  }).join('')}));
}
export function questionFrom(doc) {
  return {id:doc.legacyId || doc._id,q:doc.question || '',a:doc.answer || '',limit:doc.wordLimit ?? 120,
    refused:!!doc.refused,reason:doc.reason || '',answeredAt:doc.answeredAt || '',run:state(doc).run || null};
}
export function questionFields(q,job,order) {
  return clean({legacyId:q.id,job:reference(job),question:q.q,answer:q.a,wordLimit:q.limit,refused:!!q.refused,
    reason:q.reason || '',answeredAt:q.answeredAt || null,order,appState:JSON.stringify({run:q.run || null})});
}
export function assessmentFrom(doc) {
  if(!doc)return null;
  const choice = v=>v ? {...strip(v),probabilities:probabilityObject(v.probabilities)} : null;
  return {model:doc.model || '',policy:doc.policyVersion || '',fingerprint:doc.inputFingerprint || '',assessedAt:doc.generatedAt || '',
    score:doc.score ?? null,dimensions:(doc.dimensions || []).map(d=>({...strip(d),probabilities:probabilityObject(d.probabilities)})),
    posting:choice(doc.posting),constraint:choice(doc.constraint),blocked:!!doc.blocked,provisional:!!doc.provisional,status:doc.status || ''};
}
export function assessmentFields(a,job) {
  const choice=v=>v?{...v,probabilities:probabilityArray(v.probabilities)}:null;
  return clean({job:reference(job),legacyId:job.legacyId,model:a.model,policyVersion:a.policy,inputFingerprint:a.fingerprint,generatedAt:a.assessedAt,
    score:a.score,dimensions:keyed((a.dimensions || []).map(d=>({...d,probabilities:probabilityArray(d.probabilities)}))),posting:choice(a.posting),constraint:choice(a.constraint),
    blocked:!!a.blocked,provisional:!!a.provisional,status:a.status});
}
export const jobStrings='company role jobDescription location locationMode salary source sourceType sourceUrl externalId threadId stage archivedAt notes instructions rationale tier receivedAt createdAt updatedAt'.split(' ');
export const jobFlags=['archived','replyOwed','userViewed','closed'];
export const runtimeFields='auditStartedAt auditLegacy auditReportIds scoreBreakdown jevRun coverRun analysisRun researchRun briefRun prepareRun researchFingerprint briefFingerprint briefStage'.split(' ');
export function jobFrom(doc) {
  if(!doc || doc.deletedAt || doc.pending)return null;
  const original=state(doc), assessment=assessmentFrom(doc.assessment);
  const job={...Object.fromEntries(runtimeFields.map(k=>[k,original[k]])),id:doc.legacyId || doc._id,
    ...Object.fromEntries(jobStrings.map(k=>[k,doc[k] || ''])),...Object.fromEntries(jobFlags.map(k=>[k,!!doc[k]])),
    score:doc.score ?? null,recruiter:strip(doc.recruiter) || null,overviewSummary:strip(doc.overviewSummary) || null,
    jevAssessment:assessment,questions:(doc.questions || []).map(questionFrom),
    fitReportId:doc.report?.legacyId || '',coverLetterId:doc.cover?.versionId || '',coverLetter:null,coverLetterVersions:[],
    coverLetterAt:doc.cover?.generatedAt || '',coverLetterModel:doc.cover?.model || '',coverLetterSalutation:doc.cover?.salutation || '',coverLetterWords:doc.cover?.wordCount || 0,
    coverLetterVersionCount:doc.coverCount || 0,researchId:doc.research?.versionId || '',researchAt:doc.research?.generatedAt || '',researchModel:doc.research?.model || '',
    researchSourceCount:doc.research?.sources?.length || 0,researchPartial:!!doc.research?.partial,briefId:doc.brief?.versionId || '',briefAt:doc.brief?.generatedAt || '',briefModel:doc.brief?.model || '',
    revision:revision([doc,...doc.questions || [],doc.assessment]),
  };
  Object.defineProperty(job,metadata,{value:doc});
  return job;
}
export function jobFields(job) {
  return clean({...Object.fromEntries(jobStrings.map(k=>[k,job[k] || (k.endsWith('At') ? null : '')])),
    ...Object.fromEntries(jobFlags.map(k=>[k,!!job[k]])),score:job.score ?? null,recruiter:job.recruiter || null,overviewSummary:job.overviewSummary || null,
    legacyId:job.id,appState:JSON.stringify(Object.fromEntries(runtimeFields.map(k=>[k,job[k]])))});
}
export function reportFrom(doc) {
  if(!doc || doc.deletedAt || doc.pending)return null;
  return clean({job_title:doc.jobTitle || '',company:doc.company || '',job_description:doc.jobDescription || '',pitch:doc.pitch || '',categories:strip(doc.categories || []),
    differentiators:strip(doc.differentiators || []),closing:doc.closing || '',created_at:doc.createdAt || doc.generatedAt || '',regenerated_at:doc.regeneratedAt || undefined,
    model:doc.model || '',generation:strip(doc.generation) || null});
}
export function reportFields(r) {
  return clean({jobTitle:r.job_title || '',company:r.company || '',jobDescription:r.job_description || '',pitch:r.pitch || '',categories:keyed(r.categories),
    differentiators:keyed(r.differentiators),closing:r.closing || '',createdAt:r.created_at || null,regeneratedAt:r.regenerated_at || null,generatedAt:r.regenerated_at || r.created_at || null,
    model:r.model || '',generation:r.generation || null,publiclyShared:true});
}
export const reportRevision = doc => !doc || doc.pending ? 0 : parseInt(createHash('sha256').update(JSON.stringify({report:reportFrom(doc),activeVersionId:doc.activeVersionId || '',deletedAt:doc.deletedAt || ''})).digest('hex').slice(0,12),16);
export function artifactFrom(doc,kind,jobId) {
  if(!doc || doc.deletedAt)return null;
  const out={jobId,at:doc.generatedAt || '',model:doc.model || '',versionInstructions:doc.versionInstructions || ''};
  if(kind==='cover')return {...out,vid:doc.versionId,words:doc.wordCount || 0,salutation:doc.salutation || '',paragraphs:bodyToParagraphs(doc.body,doc.paragraphFlags || state(doc).paragraphs)};
  const points=values=>(values || []).map(v=>({text:v.text || '',src:v.basis==='posting'?'posting':v.basis==='research'?Number(v.sourceKey):null}));
  Object.assign(out,{id:doc.versionId,kind,company:doc.company || '',unknowns:doc.unknowns || [],sources:(doc.sources || []).map(s=>({id:Number(s._key),...strip(s)}))});
  const names=kind==='research'?['summary','signals','risks','roleContext']:['why','likelyQuestions','gapResponses','greenFlags','redFlags','questionsToAsk','companyReference','roleReference'];
  names.forEach(k=>{out[k]=points(doc[k]);});
  if(kind==='research')Object.assign(out,{domain:doc.domain || '',partial:!!doc.partial});
  else Object.assign(out,{role:doc.role || '',stage:doc.stage || 'screen',contact:doc.contact || '',opening:doc.opening || '',personalAnswers:strip(doc.personalAnswers || {}),
    confirmedAnswers:strip(doc.confirmedAnswers || []),conversation:{notes:doc.conversationNotes || '',receivedAt:doc.conversationReceivedAt || '',updatedAt:doc.conversationUpdatedAt || '',points:points(doc.conversation)}});
  return out;
}
export function artifactFields(kind,job,id,a) {
  const out={legacyId:job.legacyId,job:reference(job),versionId:id,generatedAt:a.at || new Date().toISOString(),model:a.model || '',versionInstructions:a.versionInstructions || ''};
  if(kind==='cover')return {...out,salutation:a.salutation || '',wordCount:a.words || 0,body:paragraphsToBody(a.paragraphs),paragraphFlags:keyed((a.paragraphs || []).map(p=>({lead:!!p.lead,fit:!!p.fit})))};
  const points=values=>keyed((values || []).map(v=>({text:v.text,basis:v.src==='posting'?'posting':typeof v.src==='number'?'research':'judgement',sourceKey:typeof v.src==='number'?String(v.src):''})));
  Object.assign(out,{company:a.company || job.company || '',unknowns:a.unknowns || [],sources:(a.sources || []).map((s,i)=>({_key:String(s.id??i),_type:'source',...Object.fromEntries(Object.entries(s).filter(([k])=>k!=='id'))}))});
  const names=kind==='research'?['summary','signals','risks','roleContext']:['why','likelyQuestions','gapResponses','greenFlags','redFlags','questionsToAsk','companyReference','roleReference'];
  names.forEach(k=>{out[k]=points(a[k]);});
  if(kind==='research')Object.assign(out,{domain:a.domain || '',partial:!!a.partial});
  else Object.assign(out,{role:a.role || job.role || '',stage:a.stage || 'screen',contact:a.contact || '',opening:a.opening || '',personalAnswers:a.personalAnswers || {},confirmedAnswers:keyed(a.confirmedAnswers),
    conversationNotes:a.conversation?.notes || '',conversationReceivedAt:a.conversation?.receivedAt || null,conversationUpdatedAt:a.conversation?.updatedAt || null,conversation:points(a.conversation?.points)});
  return clean(out);
}
