// Dry-run by default. Supply APPLICATION_CV_PHONE_E164 and
// APPLICATION_CV_PHONE_LABEL only after the owner approves the exact number.
// Updates the published CV page with a revision guard; drafts and another
// published phone stop the migration.
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createStorageClient} from '../lib/sanity/client.js';
import {safeApplicationCvContactHref} from '../lib/application-cv-contacts.js';

const required=(condition,message)=>{if(!condition)throw Error(message);};
const phoneHref=value=>safeApplicationCvContactHref(`tel:${String(value||'').trim()}`);

export async function addApplicationCvPhone({client=createStorageClient(),number,label,apply=false}={}) {
  const href=phoneHref(number);
  required(href && href===`tel:${String(number||'').trim()}`,'Supply an approved E.164 number with a leading + and 7–15 digits.');
  required(typeof label==='string' && label.trim() && !/[\u0000-\u001f\u007f<>]/.test(label),
    'Supply the approved public display label for the phone.');
  const display=label.trim();
  const reader=client.withConfig({perspective:'published'});
  const page=await reader.fetch('*[_type == "sitePage" && slug.current == "cv"][0]{_id,_rev,cv{contacts[]{...}}}');
  required(page?._id && page?._rev && Array.isArray(page.cv?.contacts),'A published structured CV contact list is required.');
  const raw=client.withConfig({perspective:'raw'});
  const draft=await raw.fetch('*[_id == $id][0]{_id}',{id:`drafts.${page._id}`});
  required(!draft,'Publish or discard the CV page draft before adding a phone.');
  const existingPhones=page.cv.contacts.filter(contact=>/^tel:/i.test(contact?.href||''));
  required(existingPhones.length<=1,'Multiple published CV phones require editorial review.');
  if(existingPhones.length){
    required(safeApplicationCvContactHref(existingPhones[0].href)===href && existingPhones[0].label===display,
      'The published CV phone was edited; preserve that value and review manually.');
    return {needed:false,applied:false};
  }
  if(!apply)return {needed:true,applied:false};
  const contact={_type:'object',_key:randomUUID().replaceAll('-','').slice(0,16),label:display,href};
  const contacts=[...page.cv.contacts];
  const emailIndex=contacts.findIndex(item=>/^mailto:/i.test(item?.href||''));
  contacts.splice(emailIndex<0?contacts.length:emailIndex+1,0,contact);
  await client.transaction().patch(page._id,patch=>patch.ifRevisionId(page._rev).set({'cv.contacts':contacts})).commit({visibility:'sync'});
  const updated=await reader.fetch('*[_id == $id][0]{cv{contacts[]{label,href}}}',{id:page._id});
  required(updated?.cv?.contacts?.some(item=>item.href===href && item.label===display),
    'The published CV phone did not read back correctly.');
  return {needed:false,applied:true};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await addApplicationCvPhone({number:process.env.APPLICATION_CV_PHONE_E164,
    label:process.env.APPLICATION_CV_PHONE_LABEL,apply:process.argv.includes('--apply')}),null,2));
