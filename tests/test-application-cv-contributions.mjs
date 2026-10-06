import assert from 'node:assert/strict';
import {buildApplicationCvContributionPlan,updateApplicationCvContributions,
  CONTRIBUTION_REPOSITORIES} from '../scripts/update-application-cv-contributions.mjs';
import {V4_CV_WRITER_PROMPT,V4_CV_VERIFIER_PROMPT} from '../scripts/seed-application-cv.mjs';

const block=text=>({_type:'block',children:[{_type:'span',text}]});
const careerPassages=[
  'Principal Engineer, TravelRepublic / Emirates Group (2018 – 2020). Led a shared PWA across three brands and built a design system and API in a larger travel business.',
  'Senior Engineer, EDITED (2014 – 2018). Built the React data-visualisation product and design system, then owned the public website.',
  'Founder, Connect Coimbra + freelance (2010 – 2014). Co-founded a coworking business, running marketing, operations and finances.',
  'Junior Engineer, Critical Software (2009 – 2010). Worked in a mission- and safety-critical engineering organisation. Built the web interface for onAll, a wearable elderly-care sensor system.',
];
const career={_id:'career',_rev:'career-rev',body:careerPassages.map(block)};
const fitPassage='Fit: Built my job-search application with Sanity, React, Vercel and Trigger.dev, directing coding agents and reviewing delivery. Open source includes figma-graphql, a GraphQL wrapper for the Figma API.';
const educationPassage='MSc and BSc in Informatics Engineering, University of Coimbra, Portugal. Speaker at React Advanced London, GraphQL Conf and Design Systems London.';
const page={_id:'page',_rev:'page-rev',cv:{name:'Test Candidate',sections:[
  {label:'Projects',items:[{body:[block(fitPassage)]}]},
  {label:'Education',items:[{body:[block(educationPassage)]}]},
]}};
const plan=buildApplicationCvContributionPlan({page,career});
assert.equal(plan.sources.length,4);
assert.equal(plan.roleEvidence.length,3);
assert.ok(plan.sources[0].passage.includes('tech hub for the city'));
assert.ok(plan.roleEvidence.find(row=>row.roleKey==='role:edited').text.includes('roughly 25 to more than 200'));
assert.ok(!plan.roleEvidence.find(row=>row.roleKey==='role:edited').text.includes('grew EDITED'));
assert.equal(CONTRIBUTION_REPOSITORIES.length,4);
assert.ok(CONTRIBUTION_REPOSITORIES.find(row=>row.label==='singlestore-notes').fact.includes('experimental'));
assert.deepEqual(plan.projects.map(row=>row.title),['Open source','Speaking']);
assert.equal(plan.projects[0].links.length,4);
const roleRows=[
  ['connect-coimbra','Co-founder','Connect Coimbra','2010 – 2014','extra:connect-business'],
  ['edited','Senior Engineer','EDITED','2014 – 2018','public:edited:0'],
  ['travelrepublic','Principal Engineer','TravelRepublic / Emirates Group','2018 – 2020','public:travelrepublic:0'],
  ['critical-software','Junior Engineer','Critical Software','2009 – 2010','extra:critical-onall'],
];
const docs=roleRows.map(([key,title,company,dates,overview])=>({_id:`id-role:${key}`,_rev:'rev',_type:'applicationCvRole',
  seedKey:`role:${key}`,title,company,dates,approvedPublic:true,overviewId:`id-${overview}`}));
for(const [key,title,order] of [['fit','Fit',0],['figma-graphql','Open source — figma-graphql',1],
  ['speaking:react-advanced-london','Speaking — React Advanced London',2],
  ['speaking:graphql-conf','Speaking — GraphQL Conf',3],
  ['speaking:design-systems-london','Speaking — Design Systems London',4]])
  docs.push({_id:`id-project:${key}`,_rev:'rev',_type:'applicationCvProject',seedKey:`project:${key}`,
    title,dates:'',location:'',order,approvedPublic:true,links:null});
for(const [index,key] of ['fit','figma-graphql','speaking:react-advanced-london',
  'speaking:graphql-conf','speaking:design-systems-london'].entries()){
  const passage=index<2?fitPassage:educationPassage;
  const text=index===0?fitPassage.split(' Open source includes')[0]:index===1?
    'Open source includes figma-graphql, a GraphQL wrapper for the Figma API.':
    `Speaker at ${['React Advanced London','GraphQL Conf','Design Systems London'][index-2]}.`;
  docs.push({_id:`id-public:project:${key}`,_rev:'rev',_type:'applicationCvEvidence',
    seedKey:`public:project:${key}`,text,sourcePassage:passage,sourceRef:'page',projectRef:`id-project:${key}`,
    order:0,contribution:index===0?'strategy':'personal',status:'delivered',approvedPublic:true,skills:[]});
}
for(const key of ['extra:connect-business','public:edited:0','public:travelrepublic:0'])
  docs.push({_id:`id-${key}`,_rev:'rev',_type:'applicationCvEvidence',seedKey:key,
    text:key==='extra:connect-business'?'Co-founded and ran Connect Coimbra, a coworking business in Coimbra.':
      key==='public:edited:0'?'Built the React data-visualisation product and design system with the design team. Later took end-to-end ownership of the public website.':
        'Led the mobile-first Next.js PWA shared by TravelRepublic, Emirates Holidays and Dnata Travel, coordinating application, design-system and API work.',
    sourceRef:key==='extra:connect-business'?'career':'page',
    sourcePassage:key==='extra:connect-business'?careerPassages[2]:
      key==='public:edited:0'?'Built the React data-visualisation product and design system with the design team. Later took end-to-end ownership of the public website.':
        'Led the mobile-first Next.js PWA shared by TravelRepublic, Emirates Holidays and Dnata Travel, coordinating application, design-system and API work.',
    roleRef:`id-role:${key==='extra:connect-business'?'connect-coimbra':key==='public:edited:0'?'edited':'travelrepublic'}`,
    approvedPublic:true,status:'delivered'});
docs.push({_id:'id-extra:critical-onall',_rev:'rev',_type:'applicationCvEvidence',seedKey:'extra:critical-onall',
  roleRef:'id-role:critical-software',sourceRef:'career',sourcePassage:careerPassages[3],
  text:'Built the web interface for onAll, a wearable real-time sensor system for elderly care.',
  approvedPublic:true,status:'delivered'});
let draft=false;
let settings={_id:'application-cv-settings',_rev:'settings-rev',prompt:V4_CV_WRITER_PROMPT,
  verifierPrompt:V4_CV_VERIFIER_PROMPT};
const sourceDocs=[];
const client={withConfig(){return this;},async fetch(query){
  if(query.includes('slug.current'))return page;
  if(query.includes('title == "My career"'))return career;
  if(query.includes('_id == "application-cv-settings"'))return settings;
  if(query.includes('migration.sourceKey in $keys'))return sourceDocs.map(doc=>({...doc,
    sources:doc.sources?.map(source=>({url:source.url,title:source.title}))}));
  if(query.includes('seedKey in $keys'))return docs.map(doc=>({...doc,
    links:doc.links?.map(link=>({href:link.href,label:link.label}))}));
  if(query.includes('_id in $ids'))return draft?[{_id:'drafts.id-role:edited'}]:[];
  throw Error(`Unexpected contributions query: ${query}`);
},transaction(){const operations=[];return {
  create(doc){operations.push({type:'create',doc});return this;},
  patch(id,build){let revision,fields;build({ifRevisionId(value){revision=value;return {
    set(value){fields=value;return this;}}}});operations.push({type:'patch',id,revision,fields});return this;},
  async commit(){for(const operation of operations){
    if(operation.type==='create'){
      const doc={...operation.doc,_rev:'created-rev',sourceKey:operation.doc.migration?.sourceKey,
        sourceRef:operation.doc.source?._ref,roleRef:operation.doc.role?._ref,
        projectRef:operation.doc.project?._ref};
      (doc._type==='candidateEvidence'?sourceDocs:docs).push(doc);
    }else{
      const doc=operation.id==='application-cv-settings'?settings:docs.find(row=>row._id===operation.id);
      assert.ok(doc);assert.equal(doc._rev,operation.revision);
      Object.assign(doc,operation.fields);
      if(operation.fields.overviewEvidence)doc.overviewId=operation.fields.overviewEvidence._ref;
      doc._rev='updated-rev';
    }
  }return {};},
};}};
const dry=await updateApplicationCvContributions({client});
assert.equal(dry.needed,true);
assert.equal(dry.promptUpgrade,true);
assert.equal(dry.createSources.length,4);
assert.equal(dry.createRecords.length,7);
assert.ok(dry.patchRecords.includes('role:connect-coimbra'));
assert.ok(dry.patchRecords.includes('extra:critical-onall'));
draft=true;
await assert.rejects(updateApplicationCvContributions({client}),/drafts/);
draft=false;
settings={...settings,prompt:'Editor-owned writing instructions.'};
await assert.rejects(updateApplicationCvContributions({client}),/prompts were edited/);
settings={...settings,prompt:V4_CV_WRITER_PROMPT};
docs.find(doc=>doc.seedKey==='role:edited').overviewId='editor-selected-evidence';
await assert.rejects(updateApplicationCvContributions({client}),/overview was edited/);
docs.find(doc=>doc.seedKey==='role:edited').overviewId='id-public:edited:0';
const applied=await updateApplicationCvContributions({client,apply:true});
assert.equal(applied.applied,true);
assert.equal(sourceDocs.length,4);
assert.equal(docs.find(doc=>doc.seedKey==='project:figma-graphql').approvedPublic,false);
const repeated=await updateApplicationCvContributions({client});
assert.equal(repeated.needed,false);
assert.deepEqual(repeated.createRecords,[]);
assert.deepEqual(repeated.patchRecords,[]);
console.log('passed 1, failed 0');
