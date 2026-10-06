import assert from 'node:assert/strict';
import {applicationCvSourceFromDocument} from '../lib/application-cv-source.js';
import {buildGeneralApplicationCv} from '../lib/application-cv-general.js';
import {planGeneralApplicationCvEvidence} from '../scripts/select-general-application-cv-evidence.mjs';

const fact=(id,text,roleId,status='delivered')=>({_id:id,_rev:`rev-${id}`,text,sourcePassage:text,
  source:{_id:'approved-source',_rev:'rev-source'},contribution:'personal',status,skills:[],role:{_ref:roleId}});
const row=(id,title,overview,extra=[])=>({_id:id,_rev:`rev-${id}`,title,company:title,dates:'2020 – 2024',
  overviewEvidenceId:overview._id,...(extra.length?{generalEvidence:extra.map(item=>({_ref:item._id}))}:{}),evidence:[overview,...extra]});
const first=fact('overview-a','Led a team delivering the product.','role-a');
const extra=fact('highlight-a','Built the design system.','role-a');
const second=fact('overview-b','Built the customer portal.','role-b');
const doc={page:{_id:'page',_rev:'rev-page',cv:{name:'Test Candidate',headline:'Engineer',contacts:[]}},
  settings:{_id:'application-cv-settings',_rev:'rev-settings',model:'gpt-5.6-sol',prompt:'Write.',verifierPrompt:'Verify.',maxWords:620,minBodyPx:13},
  roles:[row('role-a','First role',first,[extra]),row('role-b','Second role',second)],education:[],projects:[]};
const source=applicationCvSourceFromDocument(doc);
assert.deepEqual(source.roles.map(role=>role.generalEvidenceIds),[['highlight-a'],[]]);
const {content,requirementMap}=buildGeneralApplicationCv(source,{publicUrl:'https://fit.example.test/'});
assert.equal(content.variant,'general');
assert.equal(content.publicUrl,'https://fit.example.test/');
assert.equal('fitUrl' in content,false);
assert.deepEqual(requirementMap,[]);
assert.deepEqual(content.experience.map(role=>role.bullets.map(bullet=>bullet.text)),
  [[first.text,extra.text],[second.text]]);
assert.throws(()=>buildGeneralApplicationCv(source,{publicUrl:'javascript:alert(1)'}),/clean HTTPS/);
assert.throws(()=>applicationCvSourceFromDocument({...doc,roles:[{...doc.roles[0],generalEvidence:[{_ref:'missing'}]},doc.roles[1]]}),/General CV evidence/);
assert.throws(()=>applicationCvSourceFromDocument({...doc,roles:[{...doc.roles[0],generalEvidence:[{_ref:first._id}]},doc.roles[1]]}),/General CV evidence/);
assert.throws(()=>applicationCvSourceFromDocument({...doc,roles:[{...doc.roles[0],generalEvidence:[{_ref:extra._id},{_ref:extra._id}]},doc.roles[1]]}),/General CV evidence/);
assert.throws(()=>applicationCvSourceFromDocument({...doc,roles:[{...doc.roles[0],generalEvidence:[{_ref:extra._id},{_ref:'e3'},{_ref:'e4'}]},doc.roles[1]]}),/General CV evidence/);
assert.throws(()=>applicationCvSourceFromDocument({...doc,roles:[{...doc.roles[0],generalEvidence:'wrong'},doc.roles[1]]}),/General CV evidence/);
const proposed=fact('proposed','Proposed a migration.','role-a','proposed');
assert.throws(()=>applicationCvSourceFromDocument({...doc,roles:[{...doc.roles[0],generalEvidence:[{_ref:proposed._id}],evidence:[first,extra,proposed]},doc.roles[1]]}),/General CV evidence/);
const tampered=structuredClone(source);
tampered.roles[0].generalEvidenceIds=['missing'];
assert.throws(()=>buildGeneralApplicationCv(tampered,{publicUrl:'https://fit.example.test/'}),/not approved delivered/);
const published=[
  {_id:'ss',_rev:'r1',_type:'applicationCvRole',seedKey:'role:singlestore',title:'Engineering Manager',company:'SingleStore',dates:'Aug 2020 – May 2026',approvedPublic:true,overviewId:'s0'},
  {_id:'tr',_rev:'r2',_type:'applicationCvRole',seedKey:'role:travelrepublic',title:'Principal Engineer',company:'TravelRepublic / Emirates Group',dates:'2018 – 2020',approvedPublic:true,overviewId:'t0'},
  ...[['s0','public:singlestore:0','ss'],['tq7BTrlFd6TZUY20tKIzCa','public:singlestore:1','ss'],
    ['gqa1Mkwo5ifeRcwR4MdJ6f','public:singlestore:2','ss'],
    ['t0','contributions:overview:travelrepublic:v5','tr'],['HMHjmfMfrwKpGyON4tUYHI','public:travelrepublic:1','tr']]
    .map(([id,seedKey,roleRef])=>({_id:id,_rev:`rev-${id}`,_type:'applicationCvEvidence',seedKey,roleRef,
      approvedPublic:true,status:'delivered',sourceRef:'source',sourcePassage:'Original source.',
      text:id==='tq7BTrlFd6TZUY20tKIzCa'?'Led Docs v2 from beta to general availability, covering the frontend, Algolia search and deployment infrastructure. Coordinated work with Docs, Product and Design.':
        id==='gqa1Mkwo5ifeRcwR4MdJ6f'?'Owned engineering strategy and resourcing for SQRL, an AI assistant across the website, docs and cloud portal. Delegated daily UX and implementation; used Mixpanel and conversation data with PMs to guide iteration.':
          id==='HMHjmfMfrwKpGyON4tUYHI'?'Built the shared React design system and GraphQL service connecting booking and inventory systems. Set architecture and code standards across the platform.':'Approved fact.'})),
];
const patches=planGeneralApplicationCvEvidence(published);
assert.deepEqual(patches.map(patch=>patch.generalEvidence.map(ref=>ref._ref)),
  [['tq7BTrlFd6TZUY20tKIzCa','gqa1Mkwo5ifeRcwR4MdJ6f'],['HMHjmfMfrwKpGyON4tUYHI']]);
const selected=published.map(doc=>doc.seedKey==='role:singlestore'?{...doc,generalEvidence:[{_ref:'tq7BTrlFd6TZUY20tKIzCa'},{_ref:'gqa1Mkwo5ifeRcwR4MdJ6f'}]}:
  doc.seedKey==='role:travelrepublic'?{...doc,generalEvidence:[{_ref:'HMHjmfMfrwKpGyON4tUYHI'}]}:doc);
assert.deepEqual(planGeneralApplicationCvEvidence(selected),[]);
assert.throws(()=>planGeneralApplicationCvEvidence(published.map(doc=>doc.seedKey==='role:singlestore'?{...doc,generalEvidence:[{_ref:'different'}]}:doc)),/edited/);
assert.throws(()=>planGeneralApplicationCvEvidence(published.map(doc=>doc.seedKey==='public:singlestore:2'?{...doc,status:'proposed'}:doc)),/facts changed/);
assert.throws(()=>planGeneralApplicationCvEvidence(published.map(doc=>doc.seedKey==='public:singlestore:1'?{...doc,text:'Changed editorial fact.'}:doc)),/selected evidence changed/);
console.log('passed 19, failed 0');
