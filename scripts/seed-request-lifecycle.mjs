import {createStorageClient} from '../lib/sanity/client.js';
import {DEFAULT_REQUEST_LIFECYCLE,validateRequestLifecycle} from '../lib/sanity/request-lifecycle.js';
const client=createStorageClient().withConfig({perspective:'raw'});
const ids=['fit-analysis-settings','drafts.fit-analysis-settings'];
const docs=await client.fetch('*[_id in $ids]{_id,_rev,requestLifecycle}',{ids});
if(!docs.some(d=>d._id===ids[0]))throw Error('Published Analysis settings missing');
let transaction=client.transaction(),count=0;
for(const doc of docs) {
  const fields={};
  if(doc.requestLifecycle==null)fields.requestLifecycle=DEFAULT_REQUEST_LIFECYCLE;
  else {
    const merged={...doc.requestLifecycle};
    for(const [name,policy] of Object.entries(DEFAULT_REQUEST_LIFECYCLE))if(merged[name]==null){merged[name]=policy;fields[`requestLifecycle.${name}`]=policy;}
    validateRequestLifecycle(merged);
  }
  if(Object.keys(fields).length){count++;transaction=transaction.patch(doc._id,p=>p.ifRevisionId(doc._rev).setIfMissing(fields));}
}
if(process.argv.includes('--apply')&&count){await transaction.commit();console.log(`Added lifecycle policy to ${count} documents; existing edits preserved.`);}
else console.log(`${count} documents need lifecycle policy${count?'; use --apply':''}.`);
