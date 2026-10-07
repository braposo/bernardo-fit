// Dry-run by default. Select existing approved facts for the general CV.
// Never overwrite a Studio draft or a curator's different selection.
import {pathToFileURL} from 'node:url';
import {createStorageClient} from '../lib/sanity/client.js';
import {loadApplicationCvSource} from '../lib/application-cv-source.js';

const required=(condition,message)=>{if(!condition)throw Error(message);};
const choices=[
  {roleKey:'role:singlestore',title:'Engineering Manager',company:'SingleStore',dates:'2020 – 2026',
    overviewKey:'public:singlestore:0',evidenceKeys:['public:singlestore:1','public:singlestore:2'],
    evidenceIds:['tq7BTrlFd6TZUY20tKIzCa','gqa1Mkwo5ifeRcwR4MdJ6f'],evidenceTexts:[
      'Led Docs v2 from beta to general availability, covering the frontend, Algolia search and deployment infrastructure. Coordinated work with Docs, Product and Design.',
      'Owned engineering strategy and resourcing for SQRL, an AI assistant across the website, docs and cloud portal. Delegated daily UX and implementation; used Mixpanel and conversation data with PMs to guide iteration.']},
  {roleKey:'role:travelrepublic',title:'Principal Engineer',company:'TravelRepublic / Emirates Group',dates:'2018 – 2020',
    overviewKey:'contributions:overview:travelrepublic:v5',evidenceKeys:['public:travelrepublic:1'],
    evidenceIds:['HMHjmfMfrwKpGyON4tUYHI'],evidenceTexts:[
      'Built the shared React design system and GraphQL service connecting booking and inventory systems. Set architecture and code standards across the platform.']},
];
const keys=choices.flatMap(choice=>[choice.roleKey,choice.overviewKey,...choice.evidenceKeys]);
const sameIds=(actual,expected)=>Array.isArray(actual) && actual.length===expected.length &&
  actual.every((ref,index)=>ref?._ref===expected[index]);

export function planGeneralApplicationCvEvidence(docs) {
  const byKey=new Map(docs.map(doc=>[doc.seedKey,doc]));
  required(byKey.size===docs.length,'Duplicate CV seed keys need editorial review.');
  required(keys.every(key=>byKey.has(key)), 'The approved general CV facts or roles are missing.');
  const patches=[];
  for(const choice of choices){
    const role=byKey.get(choice.roleKey),overview=byKey.get(choice.overviewKey);
    required(role._type==='applicationCvRole' && role.approvedPublic===true &&
      role.title===choice.title && role.company===choice.company && role.dates===choice.dates &&
      role.overviewId===overview._id && overview._type==='applicationCvEvidence' &&
      overview.roleRef===role._id && overview.approvedPublic===true && overview.status==='delivered',
    `The ${choice.company} approved role overview changed; review before selecting general CV evidence.`);
    const evidence=choice.evidenceKeys.map(key=>byKey.get(key));
    required(evidence.every(doc=>doc._type==='applicationCvEvidence' && doc.roleRef===role._id &&
      doc.approvedPublic===true && doc.status==='delivered' && doc.sourceRef && doc.sourcePassage && doc.text),
    `The ${choice.company} general CV facts changed; review before selecting them.`);
    required(evidence.every((doc,index)=>doc._id===choice.evidenceIds[index] && doc.text===choice.evidenceTexts[index]),
      `The ${choice.company} selected evidence changed; review the general CV selection.`);
    const expected=evidence.map(doc=>doc._id);
    if(sameIds(role.generalEvidence,expected))continue;
    required(role.generalEvidence==null || Array.isArray(role.generalEvidence) && role.generalEvidence.length===0,
      `The ${choice.company} general CV selection was edited; preserve it and review manually.`);
    patches.push({roleId:role._id,revision:role._rev,roleKey:choice.roleKey,
      generalEvidence:expected.map((id,index)=>({_type:'reference',_key:`general${index}`, _ref:id}))});
  }
  return patches;
}

export async function selectGeneralApplicationCvEvidence({client=createStorageClient(),apply=false}={}) {
  const raw=client.withConfig({perspective:'raw'});
  const docs=await raw.fetch('*[_type in ["applicationCvRole","applicationCvEvidence"] && seedKey in $keys]{_id,_rev,_type,seedKey,title,company,dates,approvedPublic,status,text,sourcePassage,"sourceRef":source._ref,"roleRef":role._ref,"overviewId":overviewEvidence._ref,generalEvidence[]{_ref}}',{keys});
  required(!docs.some(doc=>doc._id.startsWith('drafts.')),'Publish or discard related Studio drafts first.');
  const draftIds=docs.map(doc=>`drafts.${doc._id}`);
  const drafts=await raw.fetch('*[_id in $ids]{_id}',{ids:draftIds});
  required(!drafts.length,'Publish or discard related Studio drafts first.');
  const patches=planGeneralApplicationCvEvidence(docs);
  if(!apply)return {needed:!!patches.length,applied:false,roles:patches.map(row=>row.roleKey)};
  if(patches.length){
    const tx=client.transaction();
    for(const patch of patches)tx.patch(patch.roleId,p=>p.ifRevisionId(patch.revision).set({generalEvidence:patch.generalEvidence}));
    await tx.commit({visibility:'sync'});
  }
  const source=await loadApplicationCvSource(null,client.withConfig({perspective:'published'}));
  for(const choice of choices){
    const role=source.roles.find(item=>item.company===choice.company);
    required(role?.generalEvidenceIds?.length===choice.evidenceKeys.length,
      `The ${choice.company} general CV selection did not publish correctly.`);
  }
  return {needed:false,applied:!!patches.length,sourceFingerprint:source.fingerprint,
    roles:choices.map(choice=>({company:choice.company,evidenceIds:source.roles.find(role=>role.company===choice.company).generalEvidenceIds}))};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await selectGeneralApplicationCvEvidence({apply:process.argv.includes('--apply')}),null,2));
