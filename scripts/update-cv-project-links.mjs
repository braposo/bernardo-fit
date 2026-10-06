// Owner-requested project links and speaking dates, verified 2026-10-06.
// Dry-run by default; preserve editorial changes and stop for related drafts.
import {pathToFileURL} from 'node:url';
import {createStorageClient} from '../lib/sanity/client.js';
import {plainText} from '../lib/sanity/codecs.js';

export const HERMANS_TEXT='Built the Solana platform and modular AI-agent system; now own the project.';
export const FIT_TEXT='Built my job-search app with React, Sanity, Vercel and Trigger.dev, directing and reviewing coding agents.';
export const OPEN_SOURCE_TEXT='Published React components, figma-graphql and an experimental React Server Components notes app.';
export const PREVIOUS_FIT_TEXT='Fit: Built my job-search application with Sanity, React, Vercel and Trigger.dev, directing coding agents and reviewing delivery.';
export const PREVIOUS_OPEN_SOURCE_TEXT='Published React component packages (react-text-loop and react-responsive-picture), the figma-graphql API wrapper, and an experimental React Server Components notes app backed by SingleStore.';
export const PROJECT_LINKS={
  fit:[{label:'fit.bernardoraposo.com',href:'https://fit.bernardoraposo.com/'}],
  hermans:[{label:'hermans.club',href:'https://www.hermans.club/'}],
  speaking:[
    {label:'React Advanced London · 2019',href:'https://noti.st/braposo/iwKalu/designing-with-graphql'},
    {label:'GraphQL Conf · 2019',href:'https://noti.st/braposo/qQaBfG/making-design-more-human-with-graphql'},
    {label:'Design Systems London · 2019',href:'https://noti.st/braposo/KRU2ob/the-human-side-of-a-design-system'},
  ],
};
const cleanLinks=links=>(links||[]).map(({label,href})=>({label,href}));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const required=(test,message)=>{if(!test)throw Error(message);};
const linked=links=>links.map((link,i)=>({_key:`link${i}`,_type:'object',...link}));
const ref=id=>({_type:'reference',_ref:id});
const projectKey='project:hermans';
const evidenceKey='public:project:hermans';

export function planCvProjectLinks({records,source}) {
  required(source?._id && source?._rev,'Published independent-work source is required.');
  const text=plainText(source.body||[]);
  const passage=text.split('\n\n').find(p=>p.startsWith('The Hermans.'));
  required(passage?.includes('now own the project outright') && passage.includes('modular AI-agent architecture'),
    'The approved Hermans source changed; review it before publication.');
  for(const needle of ['React Advanced London (2019)','GraphQL Conf, Berlin (2019)','Design Systems London (2019)'])
    required(text.includes(needle),'The approved speaking source changed: '+needle);
  const keys=['project:fit','contributions:project:open-source:v5','contributions:project:speaking:v5',
    'public:project:fit','contributions:evidence:open-source:v5',projectKey,evidenceKey];
  const relevant=records.filter(r=>keys.includes(r.seedKey));
  required(!relevant.some(r=>r._id.startsWith('drafts.')),'Related CV drafts must be resolved before publication.');
  const byKey=new Map();
  for(const record of relevant){required(!byKey.has(record.seedKey),'Duplicate CV source key: '+record.seedKey);byKey.set(record.seedKey,record);}
  const changes=[];
  for(const [key,projectKey,previous,text] of [
    ['public:project:fit','project:fit',PREVIOUS_FIT_TEXT,FIT_TEXT],
    ['contributions:evidence:open-source:v5','contributions:project:open-source:v5',PREVIOUS_OPEN_SOURCE_TEXT,OPEN_SOURCE_TEXT],
  ]) {
    const doc=byKey.get(key);
    required(doc?._type==='applicationCvEvidence' && doc.approvedPublic===true && doc.status==='delivered' &&
      doc.project?._ref===byKey.get(projectKey)?._id && [previous,text].includes(doc.text),
      'Project summary was edited: '+key);
    if(doc.text!==text)changes.push({doc,fields:{text}});
  }
  for(const [key,oldTitle,title,oldOrder,order,links] of [
    ['project:fit','Independent work','Fit',0,0,PROJECT_LINKS.fit],
    ['contributions:project:open-source:v5','Open source','Open source',1,2,null],
    ['contributions:project:speaking:v5','Speaking','Speaking',2,3,PROJECT_LINKS.speaking],
  ]) {
    const doc=byKey.get(key);
    required(doc?._type==='applicationCvProject' && doc.approvedPublic===true &&
      [oldTitle,title].includes(doc.title) && [oldOrder,order].includes(doc.order),'Project was edited: '+key);
    if(links)required(!doc.links?.length || same(cleanLinks(doc.links),links),'Project links were edited: '+key);
    const fields={title,order,...(links?{links:linked(links)}:{})};
    if(doc.title!==title || doc.order!==order || links&&!same(cleanLinks(doc.links),links))changes.push({doc,fields});
  }
  const hermans=byKey.get(projectKey),evidence=byKey.get(evidenceKey);
  if(hermans)required(hermans._type==='applicationCvProject' && hermans.title==='Hermans Club' && hermans.order===1 &&
    hermans.dates==='' && hermans.location==='' && same(cleanLinks(hermans.links),PROJECT_LINKS.hermans),
    'Hermans project was edited; preserve the editorial values.');
  if(evidence)required(hermans && evidence._type==='applicationCvEvidence' && evidence.project?._ref===hermans._id &&
    evidence.text===HERMANS_TEXT && evidence.source?._ref===source._id && evidence.sourcePassage===passage &&
    evidence.approvedPublic===true && evidence.status==='delivered' && evidence.contribution==='personal',
    'Hermans evidence was edited; preserve the editorial values.');
  return {needed:!!(changes.length||!hermans?.approvedPublic||!evidence),changes,hermans,evidence,passage,source};
}

export async function updateCvProjectLinks({client=createStorageClient(),apply=false}={}) {
  const raw=client.withConfig({perspective:'raw'});
  const [records,sources]=await Promise.all([
    raw.fetch('*[_type in ["applicationCvProject","applicationCvEvidence"]]'),
    raw.fetch('*[_type=="candidateEvidence" && title=="What I build outside work"]'),
  ]);
  required(sources.length===1 && !sources[0]._id.startsWith('drafts.'),'Independent-work source has drafts or duplicates.');
  const plan=planCvProjectLinks({records,source:sources[0]});
  const result={needed:plan.needed,applied:false,changes:plan.changes.map(r=>({key:r.doc.seedKey,...r.fields})),
    hermans:{title:'Hermans Club',text:HERMANS_TEXT,links:PROJECT_LINKS.hermans},speakingLinks:PROJECT_LINKS.speaking};
  if(!apply||!plan.needed)return result;
  // An unpublished staged project allows Sanity to allocate its ID. If the
  // guarded transaction fails, a retry reuses this record without exposing it.
  const project=plan.hermans||await client.create({_type:'applicationCvProject',seedKey:projectKey,
    title:'Hermans Club',order:1,dates:'',location:'',links:linked(PROJECT_LINKS.hermans),approvedPublic:false});
  const relatedIds=[plan.source._id,project._id,...plan.changes.map(r=>r.doc._id),...(plan.evidence?[plan.evidence._id]:[])];
  required(!await raw.fetch('count(*[_id in $ids])',{ids:relatedIds.map(id=>'drafts.'+id)}),'Related CV drafts appeared; stop publication.');
  let tx=client.transaction().patch(plan.source._id,p=>p.ifRevisionId(plan.source._rev));
  for(const {doc,fields} of plan.changes)tx=tx.patch(doc._id,p=>p.ifRevisionId(doc._rev).set(fields));
  tx=tx.patch(project._id,p=>p.ifRevisionId(project._rev).set({approvedPublic:true}));
  if(!plan.evidence)tx=tx.create({_type:'applicationCvEvidence',seedKey:evidenceKey,project:ref(project._id),
    text:HERMANS_TEXT,source:ref(plan.source._id),sourcePassage:plan.passage,contribution:'personal',
    status:'delivered',skills:[],order:0,approvedPublic:true});
  else tx=tx.patch(plan.evidence._id,p=>p.ifRevisionId(plan.evidence._rev));
  await tx.commit({visibility:'sync'});
  return {...result,needed:false,applied:true};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await updateCvProjectLinks({apply:process.argv.includes('--apply')}),null,2));
