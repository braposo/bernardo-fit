// Owner-approved shortening to retain one A4 page with the full Hermans mission.
import {createStorageClient} from '../lib/sanity/client.js';
const previous="Built the web interface for onAll, a wearable elderly-care sensor system, in Critical Software's health department within a mission- and safety-critical engineering organisation.";
const text='Built onAll’s web interface for wearable elderly-care sensors.';
const client=createStorageClient();
const rows=await client.withConfig({perspective:'raw'}).fetch(
  '*[_type=="applicationCvEvidence" && seedKey=="extra:critical-onall"]');
if(rows.length!==1 || rows[0]._id.startsWith('drafts.'))throw Error('Resolve Critical Software evidence drafts or duplicates first.');
const doc=rows[0];
if(!doc.approvedPublic || doc.status!=='delivered' || !doc.sourcePassage?.includes('onAll') ||
  ![previous,text].includes(doc.text))throw Error('Critical Software evidence was edited; preserve it for review.');
const needed=doc.text!==text;
const apply=process.argv.includes('--apply');
if(needed && apply)await client.patch(doc._id).ifRevisionId(doc._rev).set({text}).commit({visibility:'sync'});
console.log(JSON.stringify({needed:needed&&!apply,applied:needed&&apply,text}));
