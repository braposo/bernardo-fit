// Repositions the CV and candidate profile around AI-era engineering leadership,
// as agreed with the owner on 2026-10-29. Dry run by default; --apply writes.
// Only these published fields change: the CV headline, the CV profile paragraphs
// and core skills, the SingleStore role scope, and the candidate profile headline
// and positioning summary that every analysis, fit page, cover letter and answer reads.
// Each write is guarded by the revision that was read. Drafts block the run, except
// an older candidate profile draft whose text the published version already
// contains: it gets the same change and catches up, so publishing it later loses nothing.
import {pathToFileURL} from 'node:url';
import {createStorageClient} from '../lib/sanity/client.js';
import {APPLICATION_CV_SOURCE_QUERY,applicationCvSourceFromDocument} from '../lib/application-cv-source.js';
import {TWO_PAGE_PROFILE,TWO_PAGE_ROLES} from './two-page-cv-content.mjs';

export const CV_HEADLINE='Engineering Manager | AI-native product teams';
export const CANDIDATE_HEADLINE='Engineering manager for AI-native product teams';
export const CANDIDATE_SUMMARY=[
  "Bernardo Raposo is an engineering manager for AI-native product teams. He has worked across every part of how a product gets made. At SingleStore, a pre-IPO Silicon Valley company of more than 500 people, he joined as a Staff Engineer and moved into engineering management, hiring and running the Web team. Before that he was Principal Engineer at TravelRepublic in the Emirates Group, one of the first engineers at EDITED as it grew from about 25 to more than 200 people, and the founder of a profitable coworking business in Portugal. He brings engineering depth, design (design systems, design tooling, conference talks on design), marketing and growth (websites, docs, SEO, tracking and experimentation), product (a B2B analytics product, a consumer booking app, an AI assistant) and business experience at every company size.",
  "Positioning, confirmed on 29 October 2026: lead with what he brings to companies reorganising around AI. Those companies need engineering managers who understand the whole business and can build teams where people direct AI agents and own the results. Use his past roles as the evidence for that view. When a role involves AI, org design or cross-functional work, open with this view; otherwise keep it to a sentence. His work on human and agent teams is self-directed and outside an employer: he built Fit by directing Claude Code and Codex, and runs Hermans Club AI-first with specialised agents. Describe it as his own experiments that he can show, and never claim he ran AI-agent teams at an employer. He also invests in his own leadership through workshops, retreats and facilitator training, and leads by the idea that performance equals potential minus interference. Do not describe him as someone who turns problems into products.",
  "Bernardo Raposo is an Engineering Manager with experience in people leadership, frontend architecture, shared web platforms and customer-facing AI delivery. The linked evidence documents are the detailed factual source. Use the structured fields below for current work preferences. Distinguish delivered work from proposals and personal contributions from team delivery. The proposed SingleStore Next.js and Sanity migration had not started when he left in May 2026.",
];

const required=(condition,message)=>{if(!condition)throw Error(message);};
const block=(text,key)=>({_type:'block',_key:key,style:'normal',markDefs:[],children:[{_type:'span',_key:'text',text,marks:[]}]});
const skills=()=>TWO_PAGE_PROFILE.skills.map((group,index)=>({_key:`skill${index}`,_type:'object',label:group.label,items:group.items}));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const texts=blocks=>(blocks||[]).map(item=>[item._key,item.children?.[0]?.text]);

// Pure plan: the patches needed to bring the published documents to the new positioning.
export function planAiEraPositioning({page,profile,role,candidate,candidateDraft,drafts}) {
  required(!drafts.length,`Publish or discard these drafts first: ${drafts.join(', ')}.`);
  required(page?._id && profile?._id && role?._id && candidate?._id,'A CV page, profile, SingleStore role or candidate profile is missing.');
  const preferences=(candidate.summary||[]).filter(item=>item._key!=='copy0' && !item._key?.startsWith('positioning'));
  const summary=[...CANDIDATE_SUMMARY.map((text,index)=>block(text,index===2?'copy0':`positioning${index}`)),...preferences];
  const patches=[];
  if(page.cv?.headline!==CV_HEADLINE)patches.push({id:page._id,rev:page._rev,label:'cv headline',set:{'cv.headline':CV_HEADLINE}});
  const profileSet={};
  if(!same(profile.paragraphs,TWO_PAGE_PROFILE.paragraphs))profileSet.paragraphs=TWO_PAGE_PROFILE.paragraphs;
  if(!same((profile.skills||[]).map(({label,items})=>({label,items})),TWO_PAGE_PROFILE.skills))profileSet.skills=skills();
  if(Object.keys(profileSet).length)patches.push({id:profile._id,rev:profile._rev,label:'cv profile',set:profileSet});
  if(role.scope!==TWO_PAGE_ROLES.singlestore.scope)patches.push({id:role._id,rev:role._rev,label:'singlestore scope',set:{scope:TWO_PAGE_ROLES.singlestore.scope}});
  const candidateSet={};
  if(candidate.headline!==CANDIDATE_HEADLINE)candidateSet.headline=CANDIDATE_HEADLINE;
  if(!same(texts(candidate.summary),texts(summary)))candidateSet.summary=summary;
  if(Object.keys(candidateSet).length)patches.push({id:candidate._id,rev:candidate._rev,label:'candidate profile',set:candidateSet});
  if(candidateDraft) {
    const draftSet={headline:CANDIDATE_HEADLINE,summary};
    for(const [field,value] of Object.entries(candidate)) {
      if(field.startsWith('_') || field in draftSet || same(candidateDraft[field],value))continue;
      required(typeof value==='string' && typeof candidateDraft[field]==='string' && value.startsWith(candidateDraft[field]),
        `The candidate profile draft has unpublished edits to ${field}; review it in Studio first.`);
      draftSet[field]=value;
    }
    const current=([field,value])=>field==='summary' ? same(texts(candidateDraft.summary),texts(value)) : same(candidateDraft[field],value);
    if(!Object.entries(draftSet).every(current))
      patches.push({id:candidateDraft._id,rev:candidateDraft._rev,label:'candidate profile draft',set:draftSet});
  }
  return patches;
}

async function readState(client) {
  const raw=client.withConfig({perspective:'raw'});
  const state=await raw.fetch(`{
    "page":*[_type=="sitePage" && slug.current=="cv" && !(_id in path("drafts.**"))][0]{_id,_rev,cv{headline}},
    "profile":*[_id=="application-cv-profile"][0]{_id,_rev,paragraphs,skills},
    "role":*[_type=="applicationCvRole" && seedKey=="role:singlestore" && !(_id in path("drafts.**"))][0]{_id,_rev,scope},
    "candidate":*[_type=="candidateProfile" && migration.sourceKey=="candidate:bernardo" && !(_id in path("drafts.**"))][0]
  }`);
  if(state.candidate)state.candidateDraft=await raw.fetch('*[_id==$id][0]',{id:`drafts.${state.candidate._id}`});
  const ids=[state.page?._id,state.profile?._id,state.role?._id].filter(Boolean).map(id=>`drafts.${id}`);
  state.drafts=await raw.fetch('*[_id in $ids]._id',{ids});
  return state;
}

export async function applyAiEraPositioning({client=createStorageClient(),apply=false}={}) {
  const patches=planAiEraPositioning(await readState(client));
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
  console.log(JSON.stringify(await applyAiEraPositioning({apply:process.argv.includes('--apply')}),null,2));
