// Scores people-focused EM roles and hands-on tech lead roles equally, as agreed with
// the owner on 2026-11-20 ("either a hands-off EM or hands-on tech lead should score
// well because I can do both, it's more about the whole package").
// Exact-text swaps on the published analysis settings and candidate profile (and its
// identical draft); dry run by default, --apply writes with revision guards.
import {pathToFileURL} from 'node:url';
import {createStorageClient} from '../lib/sanity/client.js';
import {swapText} from './apply-hands-on-lead-positioning.mjs';

const ROUTE='Engineering leadership in either form is the preferred route, and the candidate does both well: a people-focused Engineering Manager role with little or no hands-on coding is as good a fit as a hands-on Tech Lead, Lead Engineer, Head of Engineering, Staff or Principal Engineer role. Do not prefer one work mix over the other and do not penalise a role for being mostly management or mostly technical. Judge the whole package: whether the duties draw on his engineering, leadership and cross-functional strengths, and whether the work is enjoyable and sustainable.';
export const RUBRIC={
  responsibilities:{swaps:[
    ['Hands-on engineering leadership is the preferred route: Engineering Lead, Tech Lead Manager, Head of Engineering at a small or mid-size company, Staff or Principal Engineer with real influence, or Engineering Manager with technical involvement. Compare recurring duties with building and architecture, technical direction, coaching and growing engineers, and product/design collaboration, roughly 50% building and architecture and 50% leading people.',
      `${ROUTE} Compare recurring duties with people leadership (hiring, coaching, growing careers, delivery), technical direction, building and architecture, and product/design collaboration; any mix of these is fine.`],
    ['a role with no hands-on technical work or no influence on people and direction,','a role with no leadership, technical direction or influence at all (pure ticket delivery),'],
  ],criteria:[
    'Dominant daily duties fundamentally conflict with sustainable engineering-leadership work, whether people-focused or hands-on',
    'Leadership and technical-direction work is peripheral or explicit recurring demands make the daily work a poor match',
    null,
    'Most recurring leadership or technical-direction duties align, with limited supported workload trade-offs',
    'Dominant duties closely match enjoyable, sustainable engineering leadership, people-focused or hands-on, with concrete evidence of clear work boundaries',
  ]},
  direction:{swaps:[
    ['Hands-on engineering leadership is the chosen route: Lead, Tech Lead Manager, Head of Engineering at a small or mid-size company, Staff or Principal Engineer with real influence, and Engineering Manager roles with technical involvement are all preferred.',
      'Engineering leadership in either form is the chosen route: Engineering Manager (including people-focused roles with little hands-on work), Tech Lead Manager, Lead Engineer, Head of Engineering at a small or mid-size company, and Staff or Principal Engineer with real influence are equally preferred.'],
  ],criteria:[null,
    'The role has substantial supported conflicts with this life phase or the preferred engineering-leadership route',
    null,null,
    'The role strongly supports the preferred engineering-leadership route and future independence; promotion or new CV credentials are not required',
  ]},
};
export const CANDIDATE_SWAPS=[
  ['Hands-on engineering leadership is the first preference: Engineering Lead or Lead Engineer, Tech Lead Manager, Head of Engineering at a small or mid-size company, Staff or Principal Engineer with real influence, and Engineering Manager roles that keep technical involvement. A people-management role with no hands-on work is still in range but not the goal.',
    'Engineering leadership in either form is the first preference, judged as a whole package: a people-focused Engineering Manager role and a hands-on Tech Lead, Lead Engineer, Head of Engineering, Staff or Principal Engineer role are equally good fits, because he does both well.'],
  ['building products and architecting solutions while leading and growing engineers, with a sustainable, clearly bounded remit.','leading and growing engineers and building products, in whatever mix the role needs, with a sustainable, clearly bounded remit.'],
  ['Preferred balance is roughly 50% building and architecture and 50% leading people, including architecture, reviews and decisions.','There is no preferred split between hands-on and management work: a people-focused EM role and a hands-on tech lead role are equally good fits. Architecture, reviews and decisions count as technical work.'],
  ['well-paid, sustainable hands-on engineering leadership with manageable accountability','well-paid, sustainable engineering leadership with manageable accountability'],
  ['Hands-on engineering leadership is his first preference (Lead, Tech Lead Manager, Head of Engineering, Staff or Principal Engineer, or Engineering Manager with technical involvement).','Engineering leadership is his first preference, people-focused or hands-on (Engineering Manager, Tech Lead Manager, Lead, Head of Engineering, Staff or Principal Engineer).'],
  ['Hands-on engineering leadership is my preferred next role: Lead, Tech Lead Manager, Head of Engineering, Staff or Principal Engineer, or an Engineering Manager role that keeps me building.','Engineering leadership is my preferred next role, people-focused or hands-on: Engineering Manager, Tech Lead Manager, Lead, Head of Engineering, Staff or Principal Engineer.'],
];
const required=(c,m)=>{if(!c)throw Error(m);};
const blockText=b=>(b?.children||[]).map(x=>x.text||'').join('');
const swapBlocks=(blocks,label)=>(blocks||[]).map(b=>{const t=blockText(b),n=swapText(t,CANDIDATE_SWAPS,label);return n===t?b:{...b,children:[{...b.children[0],text:n,marks:[]}]};});

export function plan({settings,candidates}) {
  const patches=[],set={};
  for(const [key,{swaps,criteria}] of Object.entries(RUBRIC)) {
    const q=(settings.questions||[]).filter(x=>x.key===key);
    required(q.length===1,`Expected one scoring question ${key}.`);
    const text=swapText(q[0].instructions,swaps,key);
    for(const [,to] of swaps)required(text.includes(to),`${key}: expected wording not found; review the live rubric first.`);
    if(text!==q[0].instructions)set[`questions[_key=="${q[0]._key}"].instructions`]=text;
    const next=q[0].criteria.map((c,i)=>criteria[i]??c);
    if(JSON.stringify(next)!==JSON.stringify(q[0].criteria))set[`questions[_key=="${q[0]._key}"].criteria`]=next;
  }
  const profile=(settings.texts||[]).find(t=>t.key==='candidateProfile');
  const profileText=swapText(profile.text,CANDIDATE_SWAPS,'settings profile');
  if(profileText!==profile.text)set[`texts[_key=="${profile._key}"].text`]=profileText;
  if(Object.keys(set).length)patches.push({id:settings._id,rev:settings._rev,label:'scoring rubric',set});
  for(const c of candidates) {
    const s={};
    for(const f of ['careerDirection','workingPreferences']){const n=swapText(c[f]||'',CANDIDATE_SWAPS,f);if(n!==c[f])s[f]=n;}
    for(const f of ['interviewSummary','motivationSummary']){const n=swapBlocks(c[f],f);if(JSON.stringify(n)!==JSON.stringify(c[f]))s[f]=n;}
    if(Object.keys(s).length)patches.push({id:c._id,rev:c._rev,label:c._id.startsWith('drafts.')?'candidate draft':'candidate profile',set:s});
  }
  return patches;
}

export async function run({client=createStorageClient(),apply=false}={}) {
  const raw=client.withConfig({perspective:'raw'});
  const state=await raw.fetch(`{"settings":*[_id=="fit-analysis-settings"][0]{_id,_rev,questions,texts},
    "candidates":*[_type=="candidateProfile" && migration.sourceKey=="candidate:bernardo"]{_id,_rev,careerDirection,workingPreferences,interviewSummary,motivationSummary},
    "drafts":*[_id=="drafts.fit-analysis-settings"]._id}`);
  required(!state.drafts.length,'Publish or discard the Analysis settings draft first.');
  const patches=plan(state);
  const summary=patches.map(p=>({record:p.label,fields:Object.keys(p.set)}));
  if(!apply)return {summary,applied:false};
  const tx=client.transaction();
  for(const p of patches)tx.patch(p.id,x=>x.ifRevisionId(p.rev).set(p.set));
  if(patches.length)await tx.commit({visibility:'sync'});
  return {summary,applied:true};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await run({apply:process.argv.includes('--apply')}),null,2));
