// Repositions the CV, candidate profile and job scoring around hands-on engineering
// leadership, as agreed with the owner on 2026-11-19 ("CV rebalance: hands-on engineering lead").
// Dry run by default; --apply writes. Every write is guarded by the revision that was read,
// and every text swap must match exactly once (or already be applied), so an unexpected
// editorial change stops the run instead of being overwritten. Drafts of the touched
// documents block the run, except a candidate profile draft identical to the published
// document, which gets the same change so publishing it later loses nothing.
import {pathToFileURL} from 'node:url';
import {createStorageClient} from '../lib/sanity/client.js';
import {APPLICATION_CV_SOURCE_QUERY,applicationCvSourceFromDocument} from '../lib/application-cv-source.js';
import * as C from './hands-on-lead-content.mjs';

const DOCS_V2_ID='application-cv-two-page-singlestore-docs-v2';
const PROVENANCE_ID='application-cv-two-page-statements';
const required=(condition,message)=>{if(!condition)throw Error(message);};
// Key order differs between what we write and what Sanity returns, so compare canonically.
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const block=(text,key)=>({_type:'block',_key:key,style:'normal',markDefs:[],children:[{_type:'span',_key:'text',text,marks:[]}]});
const blockText=item=>(item?.children||[]).map(child=>child.text||'').join('');
const withoutSystem=doc=>Object.fromEntries(Object.entries(doc||{}).filter(([key])=>!['_id','_rev','_system','_createdAt','_updatedAt'].includes(key)));

// Applies [from,to] swaps to one string. Already-applied swaps are skipped; a swap that
// matches neither once nor already-applied stops the run.
export function swapText(text,swaps,label) {
  let out=text;
  for(const [from,to] of swaps) {
    if(out.includes(to))continue;
    const count=out.split(from).length-1;
    if(count===0)continue;
    required(count===1,`${label}: expected one match for "${from.slice(0,60)}…", found ${count}.`);
    out=out.replace(from,()=>to);
  }
  return out;
}
const swapStrict=(text,swaps,label)=>{
  for(const [from,to] of swaps)required(text.includes(to) || text.split(from).length===2,`${label}: "${from.slice(0,60)}…" was not found.`);
  return swapText(text,swaps,label);
};
const swapBlocks=(blocks,swaps,label)=>(blocks||[]).map(item=>{
  const text=blockText(item),next=swapText(text,swaps,label);
  return next===text ? item : {...item,children:[{...item.children[0],text:next,marks:[]}]};
});

function candidateChanges(candidate) {
  const preferences=(candidate.summary||[]).filter(item=>!item._key?.startsWith('positioning'));
  const set={
    headline:C.LEAD_CANDIDATE_HEADLINE,
    summary:[...C.LEAD_CANDIDATE_SUMMARY.map((text,index)=>block(text,`positioning${index}`)),...preferences],
    careerDirection:C.LEAD_CAREER_DIRECTION,
    workingPreferences:swapText(candidate.workingPreferences||'',C.LEAD_TEXT_SWAPS,'workingPreferences'),
    interviewSummary:swapBlocks(candidate.interviewSummary,C.LEAD_TEXT_SWAPS,'interviewSummary'),
    motivationSummary:swapBlocks(candidate.motivationSummary,C.LEAD_TEXT_SWAPS,'motivationSummary'),
  };
  return Object.fromEntries(Object.entries(set).filter(([field,value])=>!same(candidate[field],value)));
}

function settingsChanges(settings) {
  const set={};
  const texts=settings.texts||[];
  const profile=texts.find(item=>item.key==='candidateProfile');
  required(profile?._key && typeof profile.text==='string','Analysis settings candidate profile text is missing.');
  const profileText=swapText(profile.text,C.LEAD_TEXT_SWAPS,'settings candidateProfile');
  if(profileText!==profile.text)set[`texts[_key=="${profile._key}"].text`]=profileText;
  const R=C.LEAD_RUBRIC_SWAPS;
  for(const key of ['responsibilities','evidence','scope','direction']) {
    const matches=(settings.questions||[]).filter(item=>item.key===key);
    required(matches.length===1 && matches[0]._key,`Expected one scoring question ${key}.`);
    const question=matches[0];
    const instructions=swapStrict(question.instructions||'',R[key],`question ${key}`);
    if(instructions!==question.instructions)set[`questions[_key=="${question._key}"].instructions`]=instructions;
    const criteriaSwaps=R[`${key}Criteria`];
    if(criteriaSwaps) {
      required(Array.isArray(question.criteria) && question.criteria.length===criteriaSwaps.length,`Question ${key} criteria changed shape.`);
      const criteria=question.criteria.map((item,index)=>criteriaSwaps[index] ?? item);
      if(!same(criteria,question.criteria))set[`questions[_key=="${question._key}"].criteria`]=criteria;
    }
  }
  return set;
}

// Pure plan: the patches that bring the published documents to the new positioning.
export function planHandsOnLeadPositioning(state) {
  const {page,profile,role,docsV2,provenance,fit,candidate,candidateDraft,settings,drafts}=state;
  required(!drafts.length,`Publish or discard these drafts first: ${drafts.join(', ')}.`);
  required(page?._id && profile?._id && role?._id && docsV2?._id && provenance?._id && fit?._id && candidate?._id && settings?._id,
    'A CV page, profile, SingleStore role, Docs v2 evidence, provenance, Fit project, candidate profile or analysis settings document is missing.');
  const patches=[];
  const add=(doc,label,set)=>{if(Object.keys(set).length)patches.push({id:doc._id,rev:doc._rev,label,set});};

  add(page,'cv headline',page.cv?.headline===C.LEAD_CV_HEADLINE ? {} : {'cv.headline':C.LEAD_CV_HEADLINE});
  const skills=C.LEAD_SKILLS.map((group,index)=>({_key:`skill${index}`,_type:'object',label:group.label,items:group.items}));
  add(profile,'cv profile',{
    ...(same(profile.paragraphs,C.LEAD_PROFILE_PARAGRAPHS)?{}:{paragraphs:C.LEAD_PROFILE_PARAGRAPHS}),
    ...(same((profile.skills||[]).map(({label,items})=>({label,items})),C.LEAD_SKILLS)?{}:{skills}),
  });
  const S=C.LEAD_SINGLESTORE;
  add(role,'singlestore role',Object.fromEntries(Object.entries({title:S.title,scope:S.scope,responsibilities:S.responsibilities,stack:S.stack})
    .filter(([field,value])=>!same(role[field],value))));
  add(docsV2,'docs v2 achievement',docsV2.text===C.LEAD_DOCS_V2 && docsV2.sourcePassage===C.LEAD_DOCS_V2 ? {} : {text:C.LEAD_DOCS_V2,sourcePassage:C.LEAD_DOCS_V2});
  // Keep the provenance document holding every approved statement the CV cites.
  const statements=[S.scope,...S.responsibilities,C.LEAD_DOCS_V2];
  const known=new Set((provenance.body||[]).map(blockText));
  const missing=statements.filter(text=>!known.has(text));
  if(missing.length)add(provenance,'cv statements',{body:[...(provenance.body||[]),...missing.map((text,index)=>block(text,`lead20261119_${(provenance.body||[]).length+index}`))]});
  const highlights=(fit.highlights||[]).map(item=>C.LEAD_FIT.highlightReplacements[item]||item);
  add(fit,'fit project',{...(fit.scope===C.LEAD_FIT.scope?{}:{scope:C.LEAD_FIT.scope}),...(same(highlights,fit.highlights)?{}:{highlights})});

  const candidateSet=candidateChanges(candidate);
  add(candidate,'candidate profile',candidateSet);
  if(candidateDraft) {
    required(same(withoutSystem(candidateDraft),withoutSystem(candidate)) || !Object.keys(candidateChanges(candidateDraft)).length,
      'The candidate profile draft has unpublished edits; review it in Studio first.');
    add(candidateDraft,'candidate profile draft',candidateChanges(candidateDraft));
  }
  add(settings,'scoring rubric and profile text',settingsChanges(settings));
  return patches;
}

async function readState(client) {
  const raw=client.withConfig({perspective:'raw'});
  const published='!(_id in path("drafts.**"))';
  const state=await raw.fetch(`{
    "page":*[_type=="sitePage" && slug.current=="cv" && ${published}][0]{_id,_rev,cv{headline}},
    "profile":*[_id=="application-cv-profile"][0]{_id,_rev,paragraphs,skills},
    "role":*[_type=="applicationCvRole" && seedKey=="role:singlestore" && ${published}][0]{_id,_rev,title,scope,responsibilities,stack},
    "docsV2":*[_id==$docsV2][0]{_id,_rev,text,sourcePassage},
    "provenance":*[_id==$provenance][0]{_id,_rev,body},
    "fit":*[_type=="applicationCvProject" && seedKey=="project:fit" && ${published}][0]{_id,_rev,scope,highlights},
    "candidate":*[_type=="candidateProfile" && migration.sourceKey=="candidate:bernardo" && ${published}][0],
    "settings":*[_id=="fit-analysis-settings"][0]{_id,_rev,texts,questions}
  }`,{docsV2:DOCS_V2_ID,provenance:PROVENANCE_ID});
  if(state.candidate)state.candidateDraft=await raw.fetch('*[_id==$id][0]',{id:`drafts.${state.candidate._id}`});
  const ids=[state.page?._id,state.profile?._id,state.role?._id,DOCS_V2_ID,PROVENANCE_ID,state.fit?._id,'fit-analysis-settings']
    .filter(Boolean).map(id=>`drafts.${id}`);
  state.drafts=await raw.fetch('*[_id in $ids]._id',{ids});
  return state;
}

export async function applyHandsOnLeadPositioning({client=createStorageClient(),apply=false}={}) {
  const patches=planHandsOnLeadPositioning(await readState(client));
  const summary={change:patches.map(row=>({record:row.label,fields:Object.keys(row.set)}))};
  if(!apply)return {...summary,applied:false,message:'Dry run; pass --apply to write.'};
  if(patches.length) {
    const tx=client.transaction();
    for(const row of patches)tx.patch(row.id,patch=>patch.ifRevisionId(row.rev).set(row.set));
    await tx.commit({visibility:'sync'});
  }
  // Throws with the exact problem when the published CV source is no longer valid.
  const source=applicationCvSourceFromDocument(await client.withConfig({perspective:'published'}).fetch(APPLICATION_CV_SOURCE_QUERY));
  return {...summary,applied:true,sourceFingerprint:source.fingerprint,message:'Positioning applied. Refresh the general CV PDF next.'};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await applyHandsOnLeadPositioning({apply:process.argv.includes('--apply')}),null,2));
