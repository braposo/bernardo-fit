import assert from 'node:assert/strict';
import {planAiEraPositioning,CV_HEADLINE,CANDIDATE_HEADLINE} from '../scripts/apply-ai-era-positioning.mjs';
import {TWO_PAGE_PROFILE,TWO_PAGE_ROLES} from '../scripts/two-page-cv-content.mjs';

let passed=0,failed=0;
const test=(name,fn)=>{try{fn();passed++;console.log('  ok   '+name);}catch(error){failed++;console.error('  FAIL '+name+'\n'+error.stack);}};
const block=(key,text)=>({_type:'block',_key:key,style:'normal',markDefs:[],children:[{_type:'span',_key:'text',text,marks:[]}]});
const state=()=>({drafts:[],
  page:{_id:'page',_rev:'p1',cv:{headline:'Engineering Manager | Web platforms and product engineering'}},
  profile:{_id:'application-cv-profile',_rev:'r1',paragraphs:['I turn **problems into products**.'],skills:[{_key:'skill0',label:'AI',items:['MCP servers']}]},
  role:{_id:'role',_rev:'s1',scope:'**Hired and led the Web team**.'},
  candidate:{_id:'cand',_rev:'c1',headline:'Engineering Manager',careerDirection:'EM first.\n\nCurrent preference.',
    summary:[block('copy0','Old summary.'),block('applicationPreferences0','Do not publish counts.')]}});
const apply=(current,patches)=>{for(const row of patches){
  const doc=[current.page,current.profile,current.role,current.candidate,current.candidateDraft].find(item=>item?._id===row.id);
  for(const [path,value] of Object.entries(row.set)){if(path==='cv.headline')doc.cv.headline=value;else doc[path]=value;}
}};

test('repositions the CV and candidate profile and keeps application preferences',()=>{
  const current=state(),patches=planAiEraPositioning(current);
  assert.deepEqual(patches.map(row=>row.label),['cv headline','cv profile','singlestore scope','candidate profile']);
  apply(current,patches);
  assert.equal(current.page.cv.headline,CV_HEADLINE);
  assert.deepEqual(current.profile.paragraphs,TWO_PAGE_PROFILE.paragraphs);
  assert.equal(current.role.scope,TWO_PAGE_ROLES.singlestore.scope);
  assert.equal(current.candidate.headline,CANDIDATE_HEADLINE);
  assert.equal(current.candidate.summary.at(-1)._key,'applicationPreferences0');
  assert.ok(current.candidate.summary[1].children[0].text.includes('never claim he ran AI-agent teams at an employer'));
  assert.deepEqual(planAiEraPositioning(current),[],'a second run changes nothing');
});

test('an older candidate draft catches up; one with its own edits stops the run',()=>{
  const current=state();
  current.candidateDraft={...structuredClone(current.candidate),_id:'drafts.cand',_rev:'d1',careerDirection:'EM first.'};
  const draft=planAiEraPositioning(current).find(row=>row.label==='candidate profile draft');
  assert.equal(draft.set.careerDirection,'EM first.\n\nCurrent preference.');
  current.candidateDraft.careerDirection='Something unpublished.';
  assert.throws(()=>planAiEraPositioning(current),/unpublished edits to careerDirection/);
});

test('drafts of the CV documents block the run',()=>{
  assert.throws(()=>planAiEraPositioning({...state(),drafts:['drafts.application-cv-profile']}),/Publish or discard/);
});

console.log(`passed ${passed}, failed ${failed}`);
if(failed)process.exit(1);
