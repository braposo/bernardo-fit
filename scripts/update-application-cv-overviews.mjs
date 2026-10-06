// Dry-run by default. Updates only exact seeded published CV records. Drafts,
// editorial changes and concurrent revisions stop the migration.
import {pathToFileURL} from 'node:url';
import {createStorageClient} from '../lib/sanity/client.js';
import {loadApplicationCvSource} from '../lib/application-cv-source.js';
import {buildApplicationCvSeed,ROLE_OVERVIEW_EVIDENCE_KEYS,
  DEFAULT_CV_WRITER_PROMPT,DEFAULT_CV_VERIFIER_PROMPT} from './seed-application-cv.mjs';
import {PREVIOUS_CV_WRITER_PROMPT,PREVIOUS_CV_VERIFIER_PROMPT,
  V3_CV_WRITER_PROMPT,V3_CV_VERIFIER_PROMPT} from './update-application-cv-prompts.mjs';
const pairs=[
  [V3_CV_WRITER_PROMPT,V3_CV_VERIFIER_PROMPT],
  [PREVIOUS_CV_WRITER_PROMPT,PREVIOUS_CV_VERIFIER_PROMPT],
  [DEFAULT_CV_WRITER_PROMPT,DEFAULT_CV_VERIFIER_PROMPT],
];
const required=(condition,message)=>{if(!condition)throw Error(message);};
const ref=id=>({_type:'reference',_ref:id});

export async function updateApplicationCvOverviews({client=createStorageClient(),apply=false}={}) {
  const reader=client.withConfig({perspective:'published'});
  const [page,career,technical]=await Promise.all([
    reader.fetch('*[_type == "sitePage" && slug.current == "cv"][0]{_id,cv}'),
    reader.fetch('*[_type == "candidateEvidence" && title == "My career"][0]{_id,title,body}'),
    reader.fetch('*[_type == "candidateEvidence" && title == "My technical range"][0]{_id,title,body}'),
  ]);
  const seed=buildApplicationCvSeed({page,career,technical});
  const roleKeys=Object.keys(ROLE_OVERVIEW_EVIDENCE_KEYS).map(key=>`role:${key}`);
  const evidenceKeys=Object.values(ROLE_OVERVIEW_EVIDENCE_KEYS);
  const keys=[...roleKeys,...evidenceKeys];
  const raw=client.withConfig({perspective:'raw'});
  const [settings,docs]=await Promise.all([
    raw.fetch('*[_id == "application-cv-settings"][0]{_id,_rev,prompt,verifierPrompt}'),
    raw.fetch('*[_type in ["applicationCvRole","applicationCvEvidence"] && seedKey in $keys]{_id,_rev,_type,seedKey,title,company,dates,text,sourcePassage,"sourceRef":source._ref,"roleRef":role._ref,overviewEvidence,approvedPublic,status}',{keys}),
  ]);
  required(settings,'Published application CV settings are missing.');
  const promptIndex=pairs.findIndex(([writer,verifier])=>settings.prompt===writer && settings.verifierPrompt===verifier);
  required(promptIndex>=0,'Published CV prompts were edited; preserve those editorial values and review manually.');
  const byKey=new Map(docs.map(doc=>[doc.seedKey,doc]));
  required(byKey.size===keys.length && docs.length===keys.length,'Published overview roles or approved evidence are missing or duplicated.');
  const draftIds=[settings._id,...docs.map(doc=>doc._id)].map(id=>`drafts.${id}`);
  const drafts=await raw.fetch('*[_id in $ids]{_id}',{ids:draftIds});
  required(!drafts.length,'Publish or discard the related Studio drafts before changing CV overviews.');
  const updates=[];
  for(const [roleKey,evidenceKey] of Object.entries(ROLE_OVERVIEW_EVIDENCE_KEYS)) {
    const role=byKey.get(`role:${roleKey}`),evidence=byKey.get(evidenceKey);
    const roleSeed=seed.find(row=>row.key===`role:${roleKey}`),evidenceSeed=seed.find(row=>row.key===evidenceKey);
    required(role?._type==='applicationCvRole' && evidence?._type==='applicationCvEvidence' &&
      role?.approvedPublic===true && evidence?.approvedPublic===true && evidence?.status==='delivered' &&
      evidence?.roleRef===role?._id && evidence?.sourceRef && evidence?.sourcePassage &&
      roleSeed && evidenceSeed && role.title===roleSeed.value.title && role.company===roleSeed.value.company &&
      role.dates===roleSeed.value.dates && evidence.text===evidenceSeed.value.text,
    `Overview source for ${roleKey} changed; preserve editorial facts and review manually.`);
    const existing=role.overviewEvidence?._ref;
    required(!existing || existing===evidence._id,`Overview reference for ${roleKey} was edited; preserve it and review manually.`);
    if(!existing)updates.push({roleId:role._id,revision:role._rev,evidenceId:evidence._id,key:roleKey});
  }
  const promptNeeded=promptIndex!==2;
  if(!apply)return {needed:promptNeeded||!!updates.length,applied:false,promptFrom:promptIndex===0?'v3':promptIndex===1?'original':'v4',
    overviewRoles:updates.map(row=>row.key)};
  if(promptNeeded||updates.length){
    const tx=client.transaction();
    if(promptNeeded)tx.patch(settings._id,p=>p.ifRevisionId(settings._rev).set({
      prompt:DEFAULT_CV_WRITER_PROMPT,verifierPrompt:DEFAULT_CV_VERIFIER_PROMPT}));
    for(const row of updates)tx.patch(row.roleId,p=>p.ifRevisionId(row.revision).set({overviewEvidence:ref(row.evidenceId)}));
    await tx.commit({visibility:'sync'});
  }
  const source=await loadApplicationCvSource(null,reader);
  required(source.roles.every(role=>role.overviewEvidenceId),'Overview references did not publish correctly.');
  required(source.settings.prompt===DEFAULT_CV_WRITER_PROMPT && source.settings.verifierPrompt===DEFAULT_CV_VERIFIER_PROMPT,
    'The published CV prompt pair did not update correctly.');
  return {needed:false,applied:promptNeeded||!!updates.length,sourceFingerprint:source.fingerprint,
    overviewRoles:source.roles.map(role=>({company:role.company,evidenceId:role.overviewEvidenceId}))};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await updateApplicationCvOverviews({apply:process.argv.includes('--apply')}),null,2));
