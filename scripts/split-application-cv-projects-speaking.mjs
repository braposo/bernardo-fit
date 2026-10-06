// Dry-run by default. Split only the exact approved Fit/open-source and
// education/speaking passages. Drafts or editorial changes stop the migration.
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createStorageClient} from '../lib/sanity/client.js';
import {loadApplicationCvSource} from '../lib/application-cv-source.js';
import {buildApplicationCvSeed} from './seed-application-cv.mjs';

const required=(condition,message)=>{if(!condition)throw Error(message);};
const sourceRef=id=>({_type:'reference',_ref:id});
const existingKeys=['project:fit','public:project:fit','education:coimbra','public:education:coimbra'];
const addedKeys=['project:figma-graphql','public:project:figma-graphql',
  'project:speaking:react-advanced-london','public:project:speaking:react-advanced-london',
  'project:speaking:graphql-conf','public:project:speaking:graphql-conf',
  'project:speaking:design-systems-london','public:project:speaking:design-systems-london'];
const allKeys=[...existingKeys,...addedKeys];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export async function splitApplicationCvProjectsSpeaking({client=createStorageClient(),apply=false}={}) {
  const reader=client.withConfig({perspective:'published'});
  const [page,career,technical]=await Promise.all([
    reader.fetch('*[_type == "sitePage" && slug.current == "cv"][0]{_id,cv}'),
    reader.fetch('*[_type == "candidateEvidence" && title == "My career"][0]{_id,title,body}'),
    reader.fetch('*[_type == "candidateEvidence" && title == "My technical range"][0]{_id,title,body}'),
  ]);
  const seed=new Map(buildApplicationCvSeed({page,career,technical}).map(row=>[row.key,row]));
  required(allKeys.every(key=>seed.has(key)),'The approved CV page lacks a required project or speaking fact.');
  const raw=client.withConfig({perspective:'raw'});
  const docs=await raw.fetch('*[_type in ["applicationCvProject","applicationCvEducation","applicationCvEvidence"] && seedKey in $keys]{_id,_rev,_type,seedKey,title,dates,location,order,approvedPublic,text,sourcePassage,"sourceRef":source._ref,"projectRef":project._ref,"educationRef":education._ref,contribution,status,skills}',{keys:allKeys});
  required(!docs.some(doc=>doc._id.startsWith('drafts.')),'Publish or discard related Studio drafts before splitting CV entries.');
  const byKey=new Map(docs.map(doc=>[doc.seedKey,doc]));
  required(byKey.size===docs.length,'Duplicate seeded CV project or speaking records need editorial review.');
  required(existingKeys.every(key=>byKey.has(key)),'Existing seeded Fit or education records are missing.');
  const draftIds=[page._id,...docs.map(doc=>doc._id)].map(id=>`drafts.${id}`);
  const drafts=await raw.fetch('*[_id in $ids]{_id}',{ids:draftIds});
  required(!drafts.length,'Publish or discard related Studio drafts before splitting CV entries.');

  const parentId=new Map([...byKey].map(([key,doc])=>[key,doc._id]));
  const newKeys=addedKeys.filter(key=>!byKey.has(key));
  for(const key of newKeys)if(!seed.get(key).parent)parentId.set(key,`application-cv-${randomUUID()}`);
  for(const key of existingKeys.filter(key=>!key.startsWith('public:'))){
    const doc=byKey.get(key),expected=seed.get(key);
    required(doc._type===expected.type && doc.title===expected.value.title && doc.dates===expected.value.dates &&
      doc.location===expected.value.location && doc.order===expected.value.order && doc.approvedPublic===true,
    `Seeded ${key} was edited; preserve the published entry and review manually.`);
  }
  const changed=[];
  for(const key of existingKeys.filter(key=>key.startsWith('public:'))){
    const doc=byKey.get(key),expected=seed.get(key).value;
    const parentKey=seed.get(key).parent;
    const parentRef=parentKey.startsWith('project:')?doc.projectRef:doc.educationRef;
    required(doc._type==='applicationCvEvidence' && doc.sourceRef===expected.source._ref &&
      doc.sourcePassage===expected.sourcePassage && parentRef===parentId.get(parentKey) &&
      doc.contribution===expected.contribution && doc.status==='delivered' && doc.approvedPublic===true &&
      doc.order===0 && equal(doc.skills||[],expected.skills) &&
      (doc.text===doc.sourcePassage || doc.text===expected.text),
    `Seeded ${key} was edited; preserve the published evidence and review manually.`);
    if(doc.text!==expected.text)changed.push({key,id:doc._id,revision:doc._rev,text:expected.text});
  }
  for(const key of addedKeys.filter(key=>byKey.has(key))){
    const doc=byKey.get(key),entry=seed.get(key),expected=entry.value;
    const isEvidence=entry.type==='applicationCvEvidence';
    required(doc._type===entry.type && doc.approvedPublic===true && doc.order===expected.order &&
      (isEvidence ? doc.text===expected.text && doc.sourcePassage===expected.sourcePassage &&
        doc.sourceRef===expected.source._ref && doc.projectRef===parentId.get(entry.parent) &&
        doc.contribution===expected.contribution && doc.status===expected.status && equal(doc.skills||[],expected.skills)
        : doc.title===expected.title && doc.dates===expected.dates && doc.location===expected.location),
    `Seeded ${key} was edited; preserve the published entry and review manually.`);
  }
  if(!apply)return {needed:!!(changed.length||newKeys.length),applied:false,patched:changed.map(row=>row.key),created:newKeys};
  if(changed.length||newKeys.length){
    const tx=client.transaction();
    for(const row of changed)tx.patch(row.id,patch=>patch.ifRevisionId(row.revision).set({text:row.text}));
    for(const key of newKeys){
      const entry=seed.get(key);
      if(entry.parent)continue;
      tx.create({_id:parentId.get(key),seedKey:key,...entry.value});
    }
    for(const key of newKeys){
      const entry=seed.get(key);
      if(!entry.parent)continue;
      required(parentId.has(entry.parent),`Missing project for ${key}.`);
      tx.create({_id:`application-cv-${randomUUID()}`,seedKey:key,...entry.value,project:sourceRef(parentId.get(entry.parent))});
    }
    await tx.commit({visibility:'sync'});
  }
  const source=await loadApplicationCvSource(null,reader);
  required(source.projects.some(row=>row.title==='Open source — figma-graphql') &&
    source.projects.filter(row=>row.title.startsWith('Speaking — ')).length===3 &&
    !source.education.some(row=>row.evidence.some(fact=>fact.text.includes('Speaker at '))),
  'Published CV source did not split project and speaking entries correctly.');
  return {needed:false,applied:!!(changed.length||newKeys.length),sourceFingerprint:source.fingerprint,
    projects:source.projects.map(row=>row.title)};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await splitApplicationCvProjectsSpeaking({apply:process.argv.includes('--apply')}),null,2));
