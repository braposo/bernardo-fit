import {materializeApplicationCv,validateApplicationCv} from './application-cv-generation.js';
import {buildDetailedCvContent,defaultDetailedSelection,fitDetailedCv,isDetailedSource,validateDetailedCv} from './application-cv-detailed.js';

const invalid=message=>Object.assign(new Error(message),{status:422,code:'GENERAL_CV_SOURCE_INVALID',abort:true});

// A general CV is an editorial selection of published evidence, never a model run.
// The overview anchors the full scope of every job; optional role-specific facts
// give editors a bounded way to add breadth without inventing new prose.
export function buildGeneralApplicationCv(sourceSnapshot,{publicUrl,selection:detailedSelection}={}) {
  let url;
  try {url=new URL(publicUrl);} catch {throw invalid('A canonical public site URL is required for the general CV.');}
  if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash)
    throw invalid('The general CV public URL must be a clean HTTPS site URL.');
  if(!Array.isArray(sourceSnapshot?.roles) || !sourceSnapshot.roles.length)
    throw invalid('Approved career roles are required for the general CV.');
  // The two-page general CV shows each full role's first approved achievements.
  if(isDetailedSource(sourceSnapshot)) {
    const result=buildDetailedCvContent(sourceSnapshot,detailedSelection || defaultDetailedSelection(sourceSnapshot),{variant:'general',publicUrl:url.href});
    const validation=validateDetailedCv(result.content,sourceSnapshot,[]);
    if(validation.status!=='valid')throw invalid(`The general CV failed factual validation: ${validation.issues.map(i=>i.code).join(', ')}.`);
    return result;
  }
  const selection={roles:sourceSnapshot.roles.map(role=>{
    const ids=[role.overviewEvidenceId,...(role.generalEvidenceIds||[])];
    if(!role.overviewEvidenceId || !Array.isArray(role.generalEvidenceIds||[]) ||
      ids.length>3 || new Set(ids).size!==ids.length)
      throw invalid(`The general CV selection for ${role.company||role.id} is invalid.`);
    const bullets=ids.map(id=>{
      const evidence=role.evidence?.find(item=>item.id===id && item.status==='delivered');
      if(!evidence?.text)throw invalid(`The general CV selection for ${role.company||role.id} is not approved delivered evidence.`);
      return {text:evidence.text,evidenceIds:[id]};
    });
    return {id:role.id,bullets};
  }),requirementMap:[]};
  const result=materializeApplicationCv(sourceSnapshot,selection);
  delete result.content.fitUrl;
  result.content.variant='general';
  result.content.publicUrl=url.href;
  const validation=validateApplicationCv(result.content,sourceSnapshot,[]);
  if(validation.status!=='valid')throw invalid(`The general CV failed factual validation: ${validation.issues.map(i=>i.code).join(', ')}.`);
  return result;
}

// Renders the general CV within the published page limit. A two-page CV drops
// achievements, oldest roles first, until it fits.
export async function renderGeneralApplicationCv(source,{publicUrl,build=buildGeneralApplicationCv,render}) {
  if(!isDetailedSource(source)) {
    const {content}=build(source,{publicUrl});
    return {content,rendered:await render(content,{minBodyPx:source.settings.minBodyPx})};
  }
  const fitted=await fitDetailedCv(source,defaultDetailedSelection(source),{build:selection=>build(source,{publicUrl,selection}),render});
  return {content:fitted.content,rendered:fitted.rendered};
}
