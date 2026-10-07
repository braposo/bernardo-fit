// Dry run by default. Removes the "closing" field from the published fit
// analysis prompt so new fit reports stop generating a closing sentence.
// Revision-guarded; a draft or an unexpected prompt shape stops the change.
import {pathToFileURL} from 'node:url';
import {createStorageClient} from '../lib/sanity/client.js';

const CLOSING_FIELD=/\],\n(\s*)"closing": "[^"\n]*"\n(\s*)\}/g;
const CLOSING_AI_BULLET='\n- The closing, as a forward-looking line instead of a summary.';

export function withoutClosing(text){
  if(typeof text!=='string'||!text.trim())throw Error('The published fit analysis prompt is missing.');
  const matches=text.match(CLOSING_FIELD)||[];
  if(matches.length>1)throw Error('The fit analysis prompt has more than one closing field; review manually.');
  const next=text.replace(CLOSING_FIELD,']\n$2}').replace(CLOSING_AI_BULLET,'');
  if(/"closing"\s*:/.test(next))throw Error('The fit analysis prompt still asks for a closing in an unexpected shape; review manually.');
  return next;
}

export async function removeFitReportClosing({client=createStorageClient(),apply=false}={}){
  const raw=client.withConfig({perspective:'raw'});
  const docs=await raw.fetch('*[_id in ["fit-analysis-settings","drafts.fit-analysis-settings"]]{_id,_rev,"analysis":texts[key=="analysis"]{_key,text}}');
  if(docs.some(doc=>doc._id==='drafts.fit-analysis-settings'))throw Error('Publish or discard the Analysis settings draft before changing the prompt.');
  const published=docs.find(doc=>doc._id==='fit-analysis-settings');
  if(!published?._rev)throw Error('Published Analysis settings are missing.');
  if(published.analysis?.length!==1||!/^[\w-]+$/.test(published.analysis[0]._key||''))throw Error('Expected one keyed analysis prompt.');
  const {_key,text}=published.analysis[0];
  const next=withoutClosing(text);
  if(next===text)return {needed:false,applied:false};
  if(!apply)return {needed:true,applied:false};
  await client.transaction().patch(published._id,p=>p.ifRevisionId(published._rev).set({[`texts[_key=="${_key}"].text`]:next})).commit({visibility:'sync'});
  return {needed:false,applied:true};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await removeFitReportClosing({apply:process.argv.includes('--apply')}),null,2));
