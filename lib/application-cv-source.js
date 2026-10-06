import {createHash} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createContentClient} from './sanity/client.js';
import {isKnownModel} from './models.js';

const invalid = (message) => Object.assign(new Error(message), {status:503,code:'APPLICATION_CV_SOURCE_INVALID'});
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nonempty = value => typeof value === 'string' && !!value.trim();
const reference = doc => ({documentId:doc.source?._id || doc._id,revision:doc.source?._rev || doc._rev,passage:doc.sourcePassage || ''});
const sourceContext=new AsyncLocalStorage();
export const withApplicationCvSource=(snapshot,run)=>sourceContext.run(snapshot,run);

export const APPLICATION_CV_SOURCE_QUERY = `{
  "page": *[_type == "sitePage" && slug.current == "cv"][0]{_id,_rev,cv{name,headline,contacts[]{label,href}}},
  "settings": *[_id == "application-cv-settings" && _type == "applicationCvSettings"][0]{_id,_rev,model,prompt,verifierPrompt,maxWords,minBodyPx,layout},
  "roles": *[_type == "applicationCvRole" && approvedPublic == true] | order(order asc){_id,_rev,title,company,dates,location,order,"overviewEvidenceId":overviewEvidence._ref,
    "evidence": *[_type == "applicationCvEvidence" && role._ref == ^._id && approvedPublic == true] | order(order asc){_id,_rev,text,sourcePassage,source->{_id,_rev},contribution,status,skills,order}},
  "education": *[_type == "applicationCvEducation" && approvedPublic == true] | order(order asc){_id,_rev,title,dates,location,order,
    "evidence": *[_type == "applicationCvEvidence" && education._ref == ^._id && approvedPublic == true] | order(order asc){_id,_rev,text,sourcePassage,source->{_id,_rev},contribution,status,skills,order}},
  "projects": *[_type == "applicationCvProject" && approvedPublic == true] | order(order asc){_id,_rev,title,dates,location,order,
    "evidence": *[_type == "applicationCvEvidence" && project._ref == ^._id && approvedPublic == true] | order(order asc){_id,_rev,text,sourcePassage,source->{_id,_rev},contribution,status,skills,order}}
}`;

export function applicationCvSourceFromDocument(doc) {
  const page=doc?.page, settings=doc?.settings;
  if(!nonempty(page?.cv?.name) || !Array.isArray(page.cv.contacts) || !isKnownModel(settings?.model) || !nonempty(settings?.prompt) || !nonempty(settings?.verifierPrompt)
    || !Number.isInteger(settings?.maxWords) || settings.maxWords<150 || settings.maxWords>1000
    || !Number.isFinite(settings?.minBodyPx) || settings.minBodyPx<13 || settings.minBodyPx>18
    || !Array.isArray(doc.roles) || !doc.roles.length) throw invalid('Publish CV identity, settings and approved career roles in Sanity.');
  const evidenceOf = entry => {
    if(!nonempty(entry.text) || !nonempty(entry.sourcePassage) || !entry.source?._id || !entry.source?._rev
      || !['personal','team','strategy','mixed'].includes(entry.contribution)
      || !['delivered','proposed'].includes(entry.status)) throw invalid('An approved CV evidence entry is incomplete.');
    return {id:entry._id,text:entry.text,sourceRef:reference(entry),contribution:entry.contribution,status:entry.status,
      skills:Array.isArray(entry.skills)?entry.skills.filter(nonempty):[]};
  };
  const map = row => {
    if(!nonempty(row.title) || !Array.isArray(row.evidence)) throw invalid('An approved CV section is incomplete.');
    return {id:row._id,title:row.title,company:row.company || '',dates:row.dates || '',location:row.location || '',evidence:row.evidence.map(evidenceOf)};
  };
  for(const role of doc.roles){
    const overview=role.evidence?.find(e=>e._id===role.overviewEvidenceId);
    if(!nonempty(role.overviewEvidenceId) || !overview || overview.status!=='delivered')
      throw invalid('Each published CV role needs an approved delivered overview fact from that role.');
  }
  const snapshot={identity:{name:page.cv.name,headline:page.cv.headline || '',contacts:page.cv.contacts.filter(c=>nonempty(c.label) && /^https?:\/\/|^mailto:/i.test(c.href || '')).map(c=>({label:c.label,href:c.href}))},
    roles:doc.roles.map(row=>({...map(row),overviewEvidenceId:row.overviewEvidenceId})),education:(doc.education || []).map(map),projects:(doc.projects || []).map(map),
    settings:{model:settings.model,prompt:settings.prompt,verifierPrompt:settings.verifierPrompt,maxWords:settings.maxWords,minBodyPx:settings.minBodyPx,layout:settings.layout || 'classic'},
    revisions:{identity:page._rev,settings:settings._rev,records:[...doc.roles,...(doc.education||[]),...(doc.projects||[])].flatMap(r=>[r._id+':'+r._rev,...r.evidence.map(e=>e._id+':'+e._rev)])}};
  snapshot.fingerprint=hash(snapshot);
  return structuredClone(snapshot);
}

export async function loadApplicationCvSource(_job, client) {
  if(sourceContext.getStore())return structuredClone(sourceContext.getStore());
  const document=await (client||createContentClient()).fetch(APPLICATION_CV_SOURCE_QUERY);
  return applicationCvSourceFromDocument(document);
}
