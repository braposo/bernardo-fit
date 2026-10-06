import {createContentClient} from './sanity/client.js';

export const GENERAL_CV_PUBLIC_URL='https://fit.bernardoraposo.com/';
export const GENERAL_CV_PAGE_QUERY='*[_type == "sitePage" && slug.current == "cv"][0]{_id,_rev,cv{name,headline,contacts[]{label,href}},download,"downloadUrl":download.asset->url,generalCv}';

const hex=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const parsed=value=>{try{return JSON.parse(value?.payload||'');}catch{return null;}};

function approvedPdfUrl(value) {
  try {const url=new URL(value);return url.origin==='https://cdn.sanity.io' &&
    url.pathname.startsWith('/files/quli96gc/production/') && url.pathname.endsWith('.pdf') ? url.href : '';
  } catch {return '';}
}

export function generalCvPageAvailable(page) {
  const meta=page?.generalCv,content=parsed(meta?.content);
  let publicUrl;
  try {publicUrl=new URL(content?.publicUrl);}catch{return false;}
  const assetId=page?.download?.asset?._ref || page?.downloadAssetRef;
  return !!(assetId && assetId===meta?.pdfAssetId && approvedPdfUrl(page.downloadUrl) &&
    hex(meta?.pdfSha256) && hex(meta?.sourceFingerprint) && meta?.rendererVersion &&
    content?.variant==='general' && typeof content.identity?.name==='string' && content.identity.name.trim() &&
    typeof content.identity?.headline==='string' && Array.isArray(content.experience) && content.experience.length &&
    publicUrl.href===GENERAL_CV_PUBLIC_URL && !publicUrl.username && !publicUrl.password);
}

export async function getGeneralCvAvailability(client=createContentClient()) {
  const page=await client.fetch(GENERAL_CV_PAGE_QUERY);
  const available=generalCvPageAvailable(page);
  return {available,url:available?'/bernardo-raposo-cv.pdf':''};
}
