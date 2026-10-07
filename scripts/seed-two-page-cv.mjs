// Seeds the two-page CV content agreed on 2026-10-07. Dry run by default.
//   --apply     creates the provenance record, achievement evidence and profile,
//               and fills missing two-page fields on the existing roles, projects
//               and settings. Existing values, editorial edits and drafts are kept.
//   --activate  (with --apply) then switches the published CV layout to
//               "detailed", after validating the two-page source.
import {pathToFileURL} from 'node:url';
import {createStorageClient} from '../lib/sanity/client.js';
import {APPLICATION_CV_SOURCE_QUERY,applicationCvSourceFromDocument} from '../lib/application-cv-source.js';
import {TWO_PAGE_CV_SOURCE_KEY,TWO_PAGE_PROFILE,TWO_PAGE_ROLES,TWO_PAGE_FEATURED,TWO_PAGE_CONTRIBUTIONS,TWO_PAGE_CV_PROMPT} from './two-page-cv-content.mjs';

const required=(condition,message)=>{if(!condition)throw Error(message);};
const ref=(id,key)=>({_type:'reference',_ref:id,...(key?{_key:key}:{})});
const block=(text,index)=>({_type:'block',_key:`p${index}`,style:'normal',markDefs:[],children:[{_type:'span',_key:'s0',text,marks:[]}]});
export const PROVENANCE_ID='application-cv-two-page-statements';
export const PROFILE_ID='application-cv-profile';
const evidenceId=(role,key)=>`application-cv-two-page-${role}-${key}`;
const ROLE_FACTS={singlestore:['Engineering Manager','SingleStore'],travelrepublic:['Principal Engineer','TravelRepublic / Emirates Group'],
  edited:['Senior Engineer','EDITED'],'connect-coimbra':['Co-founder','Connect Coimbra'],'critical-software':['Junior Engineer','Critical Software']};
const missing=value=>value==null || (Array.isArray(value) && !value.length) || value==='';

// Pure plan: which documents to create and which fields to fill, given the
// current raw (published and draft) documents.
export function planTwoPageCvSeed({roles,projects,settings,profile,provenance,evidence,drafts}) {
  required(!drafts.length,`Publish or discard these drafts first: ${drafts.join(', ')}.`);
  required(settings?._id==='application-cv-settings','Published application CV settings are missing.');
  const statements=Object.values(TWO_PAGE_ROLES).flatMap(role=>[role.scope,...role.responsibilities,...role.achievements.map(item=>item.text)])
    .concat(TWO_PAGE_PROFILE.paragraphs,TWO_PAGE_FEATURED.scope,TWO_PAGE_FEATURED.highlights,Object.values(TWO_PAGE_CONTRIBUTIONS));
  const create=[],patches=[];
  if(!provenance)create.push({_id:PROVENANCE_ID,_type:'candidateEvidence',title:'Application CV context — two-page CV',
    kind:'employment',body:statements.map(block),migration:{sourceKey:TWO_PAGE_CV_SOURCE_KEY}});
  else required(provenance._type==='candidateEvidence','The two-page provenance record has the wrong type.');
  for(const [key,content] of Object.entries(TWO_PAGE_ROLES)) {
    const role=roles.find(row=>row.seedKey===`role:${key}`);
    const [title,company]=ROLE_FACTS[key];
    required(role && role.company===company && [title,content.title?.to].includes(role.title),
      `The published ${company} role changed; review it in Studio before seeding.`);
    content.achievements.forEach((item,index)=>{
      const id=evidenceId(key,item.key),existing=evidence.find(row=>row._id===id);
      if(existing)required(existing.role?._ref===role._id,`Evidence ${id} belongs to another role.`);
      else create.push({_id:id,_type:'applicationCvEvidence',seedKey:`two-page:${key}:${item.key}`,text:item.text,source:ref(PROVENANCE_ID),
        sourcePassage:item.text,role:ref(role._id),contribution:item.contribution,status:'delivered',skills:[],order:300+index,approvedPublic:true});
    });
    const set={};
    const fill={depth:content.depth,scope:content.scope,responsibilities:content.responsibilities,
      achievements:content.achievements.map(item=>ref(evidenceId(key,item.key),item.key)),stack:content.stack,startsPage:content.startsPage};
    for(const [field,value] of Object.entries(fill))if(missing(role[field]) && !missing(value))set[field]=value;
    if(content.title && role.title===content.title.from)set.title=content.title.to;
    if(Object.keys(set).length)patches.push({id:role._id,rev:role._rev,label:`role:${key}`,set});
  }
  const fit=projects.find(row=>row.seedKey===TWO_PAGE_FEATURED.seedKey);
  required(fit,'The Fit project record is missing.');
  const fitSet={};
  for(const field of ['scope','highlights','stack'])if(missing(fit[field]))fitSet[field]=TWO_PAGE_FEATURED[field];
  if(fit.featured!==true)fitSet.featured=true;
  if(missing(fit.dates))fitSet.dates=TWO_PAGE_FEATURED.dates;
  if(fit.approvedPublic!==true)fitSet.approvedPublic=true;
  if(Object.keys(fitSet).length)patches.push({id:fit._id,rev:fit._rev,label:'project:fit',set:fitSet});
  for(const [seedKey,summary] of Object.entries(TWO_PAGE_CONTRIBUTIONS)) {
    const project=projects.find(row=>row.seedKey===seedKey);
    required(project,`The ${seedKey} contribution record is missing.`);
    if(missing(project.summary))patches.push({id:project._id,rev:project._rev,label:seedKey,set:{summary}});
  }
  if(!profile)create.push({_id:PROFILE_ID,_type:'applicationCvProfile',paragraphs:TWO_PAGE_PROFILE.paragraphs,
    skills:TWO_PAGE_PROFILE.skills.map((group,index)=>({_key:`skill${index}`,_type:'object',label:group.label,items:group.items})),
    contributionsIntro:TWO_PAGE_PROFILE.contributionsIntro});
  const settingsSet={};
  if(missing(settings.pages))settingsSet.pages=2;
  if(missing(settings.detailedPrompt))settingsSet.detailedPrompt=TWO_PAGE_CV_PROMPT;
  if(Object.keys(settingsSet).length)patches.push({id:settings._id,rev:settings._rev,label:'settings',set:settingsSet});
  return {create,patches};
}

async function readState(client) {
  const raw=client.withConfig({perspective:'raw'});
  const roleKeys=Object.keys(TWO_PAGE_ROLES).map(key=>`role:${key}`);
  const projectKeys=[TWO_PAGE_FEATURED.seedKey,...Object.keys(TWO_PAGE_CONTRIBUTIONS)];
  const evidenceIds=Object.entries(TWO_PAGE_ROLES).flatMap(([key,role])=>role.achievements.map(item=>evidenceId(key,item.key)));
  const state=await raw.fetch(`{
    "roles":*[_type=="applicationCvRole" && seedKey in $roleKeys && !(_id in path("drafts.**"))]{_id,_rev,seedKey,title,company,depth,scope,responsibilities,achievements,stack,startsPage},
    "projects":*[_type=="applicationCvProject" && seedKey in $projectKeys && !(_id in path("drafts.**"))]{_id,_rev,seedKey,dates,approvedPublic,featured,summary,scope,highlights,stack},
    "settings":*[_id=="application-cv-settings"][0]{_id,_rev,layout,pages,detailedPrompt},
    "profile":*[_id==$profileId][0]{_id,_rev},
    "provenance":*[_id==$provenanceId][0]{_id,_rev,_type},
    "evidence":*[_id in $evidenceIds]{_id,_rev,role}
  }`,{roleKeys,projectKeys,evidenceIds,profileId:PROFILE_ID,provenanceId:PROVENANCE_ID});
  const ids=[...state.roles,...state.projects].map(row=>row._id).concat('application-cv-settings',PROFILE_ID,PROVENANCE_ID,evidenceIds);
  state.drafts=(await raw.fetch('*[_id in $ids]._id',{ids:ids.map(id=>`drafts.${id}`)}));
  return state;
}

export async function seedTwoPageCv({client=createStorageClient(),apply=false,activate=false}={}) {
  required(!activate || apply,'--activate requires --apply.');
  const state=await readState(client);
  const plan=planTwoPageCvSeed(state);
  const summary={create:plan.create.map(doc=>doc._id),fill:plan.patches.map(row=>({record:row.label,fields:Object.keys(row.set)})),
    layout:state.settings.layout};
  if(!apply)return {...summary,applied:false,message:'Dry run; pass --apply to write, and --activate to switch the layout.'};
  if(plan.create.length || plan.patches.length) {
    const tx=client.transaction();
    for(const doc of plan.create)tx.createIfNotExists(doc);
    for(const row of plan.patches)tx.patch(row.id,patch=>patch.ifRevisionId(row.rev).set(row.set));
    await tx.commit({visibility:'sync'});
  }
  const reader=client.withConfig({perspective:'published'});
  const document=await reader.fetch(APPLICATION_CV_SOURCE_QUERY);
  // Throws with the exact problem when the two-page source is incomplete.
  const detailed=applicationCvSourceFromDocument({...document,settings:{...document.settings,layout:'detailed'}});
  if(activate && document.settings.layout!=='detailed')
    await client.transaction().patch(document.settings._id,patch=>patch.ifRevisionId(document.settings._rev).set({layout:'detailed'})).commit({visibility:'sync'});
  return {...summary,applied:true,activated:activate,sourceFingerprint:detailed.fingerprint,
    message:activate?'Two-page CV content seeded and the detailed layout is live.':'Two-page CV content seeded; the layout is unchanged.'};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await seedTwoPageCv({apply:process.argv.includes('--apply'),activate:process.argv.includes('--activate')}),null,2));
