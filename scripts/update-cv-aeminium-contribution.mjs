// Owner requested replacing SingleStore Notes with an Aeminium Labs project.
// Repository README and published independent-work evidence verified 2026-10-06.
import {createStorageClient} from '../lib/sanity/client.js';
import {plainText} from '../lib/sanity/codecs.js';
const client=createStorageClient(),raw=client.withConfig({perspective:'raw'});
const previous='Published React components, figma-graphql and an experimental React Server Components notes app.';
const text='Published React components, figma-graphql and Aeminium Labs’ Next.js Solana starter kit.';
const href='https://github.com/aeminium-labs/nextjs-solana-starter-kit';
const fact='Aeminium Labs’ nextjs-solana-starter-kit is a public Next.js and TypeScript template for Solana apps, including wallet ownership validation, transactions and server-side handling.';
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
const keys=['contributions:project:open-source:v5','contributions:evidence:open-source:v5'];
const rows=await raw.fetch('*[_type in ["applicationCvProject","applicationCvEvidence"] && seedKey in $keys]',{keys});
ensure(rows.length===2&&!rows.some(r=>r._id.startsWith('drafts.')),'Resolve open-source drafts or duplicates first.');
const project=rows.find(r=>r.seedKey===keys[0]),evidence=rows.find(r=>r.seedKey===keys[1]);
ensure(project?.approvedPublic && evidence?.approvedPublic && evidence.status==='delivered' &&
  evidence.project?._ref===project._id && [previous,text].includes(evidence.text),'Open-source records changed; preserve editorial changes.');
const source=await raw.fetch('*[_id==$id][0]',{id:evidence.source?._ref});
ensure(source?._rev,'Repository provenance is missing.');
ensure(!await raw.fetch('count(*[_id in $ids])',{ids:[source._id,project._id,evidence._id].map(id=>'drafts.'+id)}),'Related drafts exist.');
const links=project.links||[];
const expected=['react-text-loop','react-responsive-picture','figma-graphql'];
ensure(links.length===4 && expected.every((name,i)=>links[i]?.label===name && links[i]?.href===`https://github.com/braposo/${name}`) &&
  ((links[3].href==='https://github.com/braposo/singlestore-notes' && links[3].label==='singlestore-notes') ||
    (links[3].href===href && links[3].label==='Aeminium Labs · nextjs-solana-starter-kit')),'Open-source links were edited.');
const paragraphs=plainText(source.body||[]).split('\n\n');
ensure(paragraphs.slice(0,3).every((p,i)=>p.startsWith(expected[i]+' is ')),'Repository provenance changed.');
const sourcePassage=[...paragraphs.slice(0,3),fact].join('\n\n');
ensure(evidence.sourcePassage===sourcePassage || evidence.sourcePassage===[...paragraphs.slice(0,3),paragraphs.find(p=>p.startsWith('singlestore-notes is '))].join('\n\n'),
  'Evidence provenance was edited.');
const updatedLinks=[...links.slice(0,3),{_key:links[3]._key,_type:'object',label:'Aeminium Labs · nextjs-solana-starter-kit',href}];
const needed=evidence.text!==text || links[3].href!==href || evidence.sourcePassage!==sourcePassage;
const apply=process.argv.includes('--apply');
if(needed&&apply){
  const body=paragraphs.includes(fact)?source.body:[...source.body,{_type:'block',_key:'aeminium-starter-20261006',style:'normal',markDefs:[],children:[{_type:'span',_key:'text',text:fact,marks:[]}]}];
  const sources=(source.sources||[]).some(s=>s.url===href)?source.sources:[...(source.sources||[]),{_type:'source',_key:'aeminium-starter',title:'Aeminium Labs nextjs-solana-starter-kit',url:href}];
  await client.transaction()
    .patch(source._id,p=>p.ifRevisionId(source._rev).set({body,sources}))
    .patch(project._id,p=>p.ifRevisionId(project._rev).set({links:updatedLinks}))
    .patch(evidence._id,p=>p.ifRevisionId(evidence._rev).set({text,sourcePassage}))
    .commit({visibility:'sync'});
}
console.log(JSON.stringify({needed:needed&&!apply,applied:needed&&apply,text,links:updatedLinks.map(({label,href})=>({label,href}))}));
