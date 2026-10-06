import assert from 'node:assert/strict';
import {planCvProjectLinks,HERMANS_TEXT,PREVIOUS_HERMANS_TEXT,PROJECT_LINKS,PREVIOUS_FIT_TEXT,PREVIOUS_OPEN_SOURCE_TEXT} from '../scripts/update-cv-project-links.mjs';
const passage='The Hermans. I now own the project outright and built a modular AI-agent architecture.';
const source={_id:'source',_rev:'source-rev',body:[passage,'React Advanced London (2019)','GraphQL Conf, Berlin (2019)','Design Systems London (2019)'].map(text=>({_type:'block',children:[{_type:'span',text}]}))};
const records=[['project:fit','Independent work',0],['contributions:project:open-source:v5','Open source',1],['contributions:project:speaking:v5','Speaking',2]]
  .map(([seedKey,title,order],i)=>({_id:`project-${i}`,_rev:'r1',_type:'applicationCvProject',seedKey,title,order,approvedPublic:true,links:[]}));
records.push(...[['public:project:fit','project-0',PREVIOUS_FIT_TEXT],['contributions:evidence:open-source:v5','project-1',PREVIOUS_OPEN_SOURCE_TEXT]]
  .map(([seedKey,id,text],i)=>({_id:`existing-evidence-${i}`,_rev:'e0',_type:'applicationCvEvidence',seedKey,project:{_ref:id},text,approvedPublic:true,status:'delivered'})));
const plan=planCvProjectLinks({records,source});
assert.equal(plan.needed,true);assert.equal(plan.changes.length,5);
const edited=structuredClone(records);edited[0].links=[{label:'Editorial link',href:'https://example.test'}];
assert.throws(()=>planCvProjectLinks({records:edited,source}),/links were edited/);
assert.throws(()=>planCvProjectLinks({records:[...records,{...records[0],_id:'drafts.project-0'}],source}),/drafts/);
assert.throws(()=>planCvProjectLinks({records:[...records,{...records[0],_id:'duplicate'}],source}),/Duplicate/);
assert.throws(()=>planCvProjectLinks({records,source:{...source,body:[]}}),/source changed/);
const changed=records.map(doc=>({...doc,...plan.changes.find(r=>r.doc._id===doc._id)?.fields}));
const project={_id:'hermans',_rev:'h1',_type:'applicationCvProject',seedKey:'project:hermans',title:'Hermans Club',order:1,dates:'',location:'',links:PROJECT_LINKS.hermans,approvedPublic:false};
assert.equal(planCvProjectLinks({records:[...changed,project],source}).needed,true,'staged record resumes publication');
const evidence={_id:'evidence',_rev:'e1',_type:'applicationCvEvidence',seedKey:'public:project:hermans',project:{_ref:'hermans'},text:HERMANS_TEXT,source:{_ref:source._id},sourcePassage:HERMANS_TEXT,approvedPublic:true,status:'delivered',contribution:'personal'};
const updatedSource={...source,body:[...source.body,{_type:'block',children:[{_type:'span',text:HERMANS_TEXT}]}]};
assert.equal(planCvProjectLinks({records:[...changed,{...project,approvedPublic:true},evidence],source:updatedSource}).needed,false,'completed migration is idempotent');
const upgrade=planCvProjectLinks({records:[...changed,{...project,approvedPublic:true},{...evidence,text:PREVIOUS_HERMANS_TEXT,sourcePassage:passage}],source});
assert.equal(upgrade.sourceNeeded,true);
assert.deepEqual(upgrade.changes.map(r=>r.fields),[{text:HERMANS_TEXT,sourcePassage:HERMANS_TEXT}]);
assert.throws(()=>planCvProjectLinks({records:[...changed,project,{...evidence,text:'An editorial revision'}],source}),/evidence was edited/);
console.log('passed 11, failed 0');
