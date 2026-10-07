import {createHash} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createContentClient} from './sanity/client.js';
import {isKnownModel} from './models.js';
import {safeApplicationCvContactHref} from './application-cv-contacts.js';
import {publicApplicationCvLinks} from './application-cv-links.js';

const invalid = (message) => Object.assign(new Error(message), {status:503,code:'APPLICATION_CV_SOURCE_INVALID'});
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nonempty = value => typeof value === 'string' && !!value.trim();
const reference = doc => ({documentId:doc.source?._id || doc._id,revision:doc.source?._rev || doc._rev,passage:doc.sourcePassage || ''});
const sourceContext=new AsyncLocalStorage();
export const withApplicationCvSource=(snapshot,run)=>sourceContext.run(snapshot,run);

export const APPLICATION_CV_SOURCE_QUERY = `{
  "page": *[_type == "sitePage" && slug.current == "cv"][0]{_id,_rev,cv{name,headline,contacts[]{label,href}}},
  "settings": *[_id == "application-cv-settings" && _type == "applicationCvSettings"][0]{_id,_rev,model,prompt,verifierPrompt,maxWords,minBodyPx,layout,pages,detailedPrompt},
  "profile": *[_id == "application-cv-profile" && _type == "applicationCvProfile"][0]{_id,_rev,paragraphs,skills[]{label,items},contributionsIntro},
  "roles": *[_type == "applicationCvRole" && approvedPublic == true] | order(order asc){_id,_rev,title,company,dates,location,order,"overviewEvidenceId":overviewEvidence._ref,generalEvidence[]{_ref},
    depth,scope,responsibilities,"achievementIds":achievements[]._ref,stack,startsPage,
    "evidence": *[_type == "applicationCvEvidence" && role._ref == ^._id && approvedPublic == true] | order(order asc){_id,_rev,text,sourcePassage,source->{_id,_rev},contribution,status,skills,order}},
  "education": *[_type == "applicationCvEducation" && approvedPublic == true] | order(order asc){_id,_rev,title,dates,location,order,
    "evidence": *[_type == "applicationCvEvidence" && education._ref == ^._id && approvedPublic == true] | order(order asc){_id,_rev,text,sourcePassage,source->{_id,_rev},contribution,status,skills,order}},
  "projects": *[_type == "applicationCvProject" && approvedPublic == true] | order(order asc){_id,_rev,title,dates,location,order,links[]{label,href},
    featured,summary,scope,highlights,stack,
    "evidence": *[_type == "applicationCvEvidence" && project._ref == ^._id && approvedPublic == true] | order(order asc){_id,_rev,text,sourcePassage,source->{_id,_rev},contribution,status,skills,order}}
}`;

const texts=value=>Array.isArray(value) ? value.filter(nonempty).map(item=>item.trim()) : [];
const DEPTHS=['full','short','earlier'];

// The two-page ("detailed") layout adds fixed editorial text per role and a
// profile. It is validated only when published settings select that layout,
// so the one-page source and its fingerprint are unchanged until then.
function detailedParts(doc,settings,projects) {
  const profile=doc.profile;
  if(!Number.isInteger(settings.pages) || settings.pages<1 || settings.pages>3 || !nonempty(settings.detailedPrompt))
    throw invalid('Publish the two-page CV page limit and achievement selection instructions in Sanity.');
  const skills=Array.isArray(profile?.skills) ? profile.skills.map(group=>({label:String(group?.label||'').trim(),items:texts(group?.items)})) : [];
  if(!texts(profile?.paragraphs).length || !skills.length || skills.some(group=>!group.label || !group.items.length))
    throw invalid('Publish the two-page CV profile with its paragraphs and core skills in Sanity.');
  const roles=doc.roles.map(role=>{
    const depth=role.depth || 'full',achievementIds=Array.isArray(role.achievementIds) ? role.achievementIds : [];
    const detail={depth,scope:String(role.scope||'').trim(),responsibilities:texts(role.responsibilities),
      achievementIds,stack:texts(role.stack),startsPage:role.startsPage===true};
    if(!DEPTHS.includes(depth) || !detail.scope || (depth==='short' && !detail.responsibilities.length) ||
      (depth==='full' && !achievementIds.length) || new Set(achievementIds).size!==achievementIds.length ||
      achievementIds.some(id=>!role.evidence.some(e=>e._id===id && e.status==='delivered')))
      throw invalid(`The two-page CV entry for ${role.company||role.title} needs a scope and, for a full entry, approved delivered achievements from that role.`);
    return detail;
  });
  const projectDetails=projects.map(project=>{
    const detail={featured:project.featured===true,summary:String(project.summary||'').trim(),scope:String(project.scope||'').trim(),
      highlights:texts(project.highlights),stack:texts(project.stack)};
    if(detail.featured && (!detail.scope || !detail.highlights.length))
      throw invalid(`The featured project ${project.title} needs a scope and highlights.`);
    return detail;
  });
  return {profile:{paragraphs:texts(profile.paragraphs),skills,contributionsIntro:String(profile.contributionsIntro||'').trim()},
    pages:settings.pages,detailedPrompt:settings.detailedPrompt,roles,projects:projectDetails,revision:profile._id+':'+profile._rev};
}

export function applicationCvSourceFromDocument(doc) {
  const page=doc?.page, settings=doc?.settings;
  if(!nonempty(page?.cv?.name) || !Array.isArray(page.cv.contacts) || !isKnownModel(settings?.model) || !nonempty(settings?.prompt) || !nonempty(settings?.verifierPrompt)
    || !Number.isInteger(settings?.maxWords) || settings.maxWords<150 || settings.maxWords>1000
    || !Number.isFinite(settings?.minBodyPx) || settings.minBodyPx<13 || settings.minBodyPx>18
    || !Array.isArray(doc.roles) || !doc.roles.length) throw invalid('Publish CV identity, settings and approved career roles in Sanity.');
  const layout=settings.layout || 'classic';
  if(!['classic','detailed'].includes(layout))throw invalid('The published CV layout is not supported.');
  // Two-page copy marks bold phrases with **double asterisks**; the one-page
  // CV has no bold text, so its facts drop the markers.
  const factText=text=>layout==='detailed' ? text : text.replace(/\*\*/g,'');
  const evidenceOf = entry => {
    if(!nonempty(entry.text) || !nonempty(entry.sourcePassage) || !entry.source?._id || !entry.source?._rev
      || !['personal','team','strategy','mixed'].includes(entry.contribution)
      || !['delivered','proposed'].includes(entry.status)) throw invalid('An approved CV evidence entry is incomplete.');
    return {id:entry._id,text:factText(entry.text),sourceRef:reference(entry),contribution:entry.contribution,status:entry.status,
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
    const selected=role.generalEvidence ?? [];
    if(!Array.isArray(selected) || selected.length>2 || selected.some(ref=>!nonempty(ref?._ref) ||
      ref._ref===role.overviewEvidenceId || !role.evidence.some(e=>e._id===ref._ref && e.status==='delivered')) ||
      new Set(selected.map(ref=>ref._ref)).size!==selected.length)
      throw invalid('General CV evidence must contain at most two distinct approved delivered facts from the same role.');
  }
  // Featured projects (Fit) belong to the two-page layout only.
  const projects=(doc.projects || []).filter(project=>layout==='detailed' || project.featured!==true);
  const detailed=layout==='detailed' ? detailedParts(doc,settings,projects) : null;
  const snapshot={identity:{name:page.cv.name,headline:page.cv.headline || '',contacts:page.cv.contacts.filter(c=>nonempty(c?.label) && safeApplicationCvContactHref(c?.href))
      .map(c=>({label:c.label,href:safeApplicationCvContactHref(c.href)}))},
    roles:doc.roles.map(row=>({...map(row),overviewEvidenceId:row.overviewEvidenceId,
      generalEvidenceIds:(row.generalEvidence||[]).map(ref=>ref._ref),...(detailed?{detail:detailed.roles[doc.roles.indexOf(row)]}:{})})),
    education:(doc.education || []).map(map),projects:projects.map((row,index)=>{
      const links=publicApplicationCvLinks(row.links);
      if(row.links!=null && (!Array.isArray(row.links) || links.length!==row.links.length))throw invalid('Approved contribution links must have a label and safe HTTP(S) URL.');
      return {...map(row),links,...(detailed?{detail:detailed.projects[index]}:{})};
    }),
    settings:{model:settings.model,prompt:settings.prompt,verifierPrompt:settings.verifierPrompt,maxWords:settings.maxWords,minBodyPx:settings.minBodyPx,layout,
      ...(detailed?{pages:detailed.pages,detailedPrompt:detailed.detailedPrompt}:{})},
    ...(detailed?{profile:detailed.profile}:{}),
    revisions:{identity:page._rev,settings:settings._rev,records:[...doc.roles,...(doc.education||[]),...projects].flatMap(r=>[r._id+':'+r._rev,...r.evidence.map(e=>e._id+':'+e._rev)])
      .concat(detailed?[detailed.revision]:[])}};
  snapshot.fingerprint=hash(snapshot);
  return structuredClone(snapshot);
}

export async function loadApplicationCvSource(_job, client) {
  if(sourceContext.getStore())return structuredClone(sourceContext.getStore());
  const document=await (client||createContentClient()).fetch(APPLICATION_CV_SOURCE_QUERY);
  return applicationCvSourceFromDocument(document);
}
