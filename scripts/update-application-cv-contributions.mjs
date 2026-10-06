// Dry-run by default. The approved facts below come from the owner's 2026-10-06
// confirmation, the published career narrative and the linked public repos.
// Only exact seeded records are changed. Drafts/editorial edits stop the run.
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createStorageClient} from '../lib/sanity/client.js';
import {plainText} from '../lib/sanity/codecs.js';
import {DEFAULT_CV_WRITER_PROMPT,DEFAULT_CV_VERIFIER_PROMPT,
  V4_CV_WRITER_PROMPT,V4_CV_VERIFIER_PROMPT} from './seed-application-cv.mjs';

const required=(condition,message)=>{if(!condition)throw Error(message);};
const ref=id=>({_type:'reference',_ref:id});
const sameLinks=(actual,expected)=>Array.isArray(actual) && actual.length===expected.length &&
  actual.every((link,index)=>link?.label===expected[index].label && link?.href===expected[index].href);
const body=paragraphs=>paragraphs.map((text,index)=>({_type:'block',_key:`p${index}`,style:'normal',markDefs:[],
  children:[{_type:'span',_key:'s0',text,marks:[]}]}));
const passageContaining=(blocks,needle)=>plainText(blocks||[]).split('\n\n').find(p=>p.includes(needle))?.trim()||'';
const ownerFacts=[
  {key:'connect-coimbra',careerNeedle:'Founder, Connect Coimbra + freelance',organisation:'Connect Coimbra',
    quote:'with stuff like Connect Coimbra, for example, when I was running, like, the co-working spot. So I learned about business, I learned about marketing, about just the financial side. I also developed, like, a tech hub for the city, so, like, events, organizing, etc.',
    text:'Co-founded and ran Connect Coimbra, a coworking business spanning marketing, finances and daily operations; developed a city tech hub and organised events.',contribution:'mixed'},
  {key:'edited',careerNeedle:'Senior Engineer, EDITED',organisation:'EDITED',
    quote:'Then I edited. It was, like, how a small startup, when I joined, was, like, 25, and how it grew to more than 200, and yeah, like setting up, like, the engineering standards from the beginning and learning more about that and having, like, many different roles or responsibilities inside of the company.',
    text:'Built the React data-visualisation product and design system, later owned the public website, and helped establish engineering standards while EDITED grew from roughly 25 to more than 200 people.',contribution:'mixed'},
  {key:'travelrepublic',careerNeedle:'Principal Engineer, TravelRepublic / Emirates Group',organisation:'TravelRepublic / Emirates Group',
    quote:'Then going to, like, Travel Republic, which was part of, like, the Emirates Group, which is a much, much larger organization. So I got, like, the experience about dealing with that, like with how larger organizations work, with how, like, the leadership is, like, in a different country, and you have to kind of learn how to deal with that, and yeah, like exposed to a lot of traffic, a lot of usage as well.',
    text:'Led the shared multi-brand Next.js PWA, coordinating application, design-system and API work across TravelRepublic, Emirates Holidays and Dnata Travel within the larger Emirates Group, working with leadership in another country on a high-traffic platform.',contribution:'mixed'},
];
export const CONTRIBUTION_REPOSITORIES=[
  {label:'react-text-loop',href:'https://github.com/braposo/react-text-loop',fact:'react-text-loop is a public React component repository for animating words in headings.'},
  {label:'react-responsive-picture',href:'https://github.com/braposo/react-responsive-picture',fact:'react-responsive-picture is a public responsive-image React component repository supporting the Picture specification.'},
  {label:'figma-graphql',href:'https://github.com/braposo/figma-graphql',fact:'figma-graphql is a public GraphQL wrapper for the Figma API.'},
  {label:'singlestore-notes',href:'https://github.com/braposo/singlestore-notes',fact:'singlestore-notes is an experimental React Server Components and Next.js notes app using SingleStore DB; its README says it is not ready for adoption.'},
];
const repoSummary='Published React component packages (react-text-loop and react-responsive-picture), the figma-graphql API wrapper, and an experimental React Server Components notes app backed by SingleStore.';
const speakingSummary='Speaker at React Advanced London, GraphQL Conf and Design Systems London.';
const criticalSummary="Built the web interface for onAll, a wearable elderly-care sensor system, in Critical Software's health department within a mission- and safety-critical engineering organisation.";
const sourceKey=key=>`application-cv-contributions:${key}:2026-10-06`;
const rowKey=key=>`contributions:${key}:v5`;

export function buildApplicationCvContributionPlan({page,career}) {
  required(page?._id && career?._id && Array.isArray(career.body),'Published CV page and career source are required.');
  const sources=ownerFacts.map(fact=>{
    const original=passageContaining(career.body,fact.careerNeedle);
    required(original,`The approved career passage for ${fact.organisation} is missing.`);
    const paragraphs=[original,fact.quote];
    return {key:sourceKey(fact.key),value:{_type:'candidateEvidence',title:`Application CV context — ${fact.organisation}`,
      kind:'employment',organisation:fact.organisation,body:body(paragraphs),migration:{sourceKey:sourceKey(fact.key)}},passage:paragraphs.join('\n\n')};
  });
  const repoParagraphs=CONTRIBUTION_REPOSITORIES.map(repo=>repo.fact);
  sources.push({key:sourceKey('open-source'),value:{_type:'candidateEvidence',title:'Application CV open-source repository verification',
    kind:'project',body:body(repoParagraphs),sources:CONTRIBUTION_REPOSITORIES.map((repo,index)=>({
      _type:'source',_key:`repo${index}`,title:repo.label,url:repo.href})),migration:{sourceKey:sourceKey('open-source')}},
    passage:repoParagraphs.join('\n\n')});
  const roleEvidence=ownerFacts.map(fact=>({key:rowKey(`overview:${fact.key}`),roleKey:`role:${fact.key}`,
    sourceKey:sourceKey(fact.key),text:fact.text,contribution:fact.contribution}));
  const speakingSource='MSc and BSc in Informatics Engineering, University of Coimbra, Portugal. Speaker at React Advanced London, GraphQL Conf and Design Systems London.';
  const projects=[
    {key:rowKey('project:open-source'),title:'Open source',order:1,sourceKey:sourceKey('open-source'),
      passage:repoParagraphs.join('\n\n'),text:repoSummary,links:CONTRIBUTION_REPOSITORIES.map((repo,index)=>({
        _type:'object',_key:`link${index}`,label:repo.label,href:repo.href}))},
    {key:rowKey('project:speaking'),title:'Speaking',order:2,sourceId:page._id,
      passage:speakingSource,text:speakingSummary,links:[]},
  ];
  return {sources,roleEvidence,projects,criticalSummary};
}

const oldProjectKeys=['project:fit','project:figma-graphql','project:speaking:react-advanced-london',
  'project:speaking:graphql-conf','project:speaking:design-systems-london'];
const oldProjectEvidenceKeys=['public:project:fit','public:project:figma-graphql',
  'public:project:speaking:react-advanced-london','public:project:speaking:graphql-conf',
  'public:project:speaking:design-systems-london'];
const oldOverviewKeys=['role:connect-coimbra','role:edited','role:travelrepublic','role:critical-software'];
const oldOverviewEvidenceKeys=['extra:connect-business','public:edited:0','public:travelrepublic:0'];
const newKeys=[...ownerFacts.map(f=>rowKey(`overview:${f.key}`)),rowKey('project:open-source'),
  rowKey('evidence:open-source'),rowKey('project:speaking'),rowKey('evidence:speaking')];
const allKeys=[...oldProjectKeys,...oldProjectEvidenceKeys,...oldOverviewKeys,...oldOverviewEvidenceKeys,
  'extra:critical-onall',...newKeys];
const oldTitles=new Map([['project:fit','Fit'],['project:figma-graphql','Open source — figma-graphql'],
  ['project:speaking:react-advanced-london','Speaking — React Advanced London'],
  ['project:speaking:graphql-conf','Speaking — GraphQL Conf'],
  ['project:speaking:design-systems-london','Speaking — Design Systems London']]);

export async function updateApplicationCvContributions({client=createStorageClient(),apply=false}={}) {
  const reader=client.withConfig({perspective:'published'});
  const [page,career]=await Promise.all([
    reader.fetch('*[_type == "sitePage" && slug.current == "cv"][0]{_id,_rev,cv{name,sections}}'),
    reader.fetch('*[_type == "candidateEvidence" && title == "My career"][0]{_id,_rev,title,body}'),
  ]);
  const plan=buildApplicationCvContributionPlan({page,career});
  const pagePassages=(page.cv.sections||[]).flatMap(section=>(section.items||[]).map(item=>plainText(item.body||[])));
  const fitPassage=pagePassages.find(p=>p.startsWith('Fit: Built my job-search application'));
  const educationPassage=pagePassages.find(p=>p.includes(speakingSummary));
  required(fitPassage?.includes('Open source includes figma-graphql') && educationPassage,
    'The published CV project or speaking source passage changed.');
  const raw=client.withConfig({perspective:'raw'});
  const [settings,docs,sourceDocs]=await Promise.all([
    raw.fetch('*[_id == "application-cv-settings"][0]{_id,_rev,prompt,verifierPrompt}'),
    raw.fetch('*[_type in ["applicationCvRole","applicationCvProject","applicationCvEvidence"] && seedKey in $keys]{_id,_rev,_type,seedKey,title,company,dates,location,order,approvedPublic,text,sourcePassage,"sourceRef":source._ref,"roleRef":role._ref,"projectRef":project._ref,"overviewId":overviewEvidence._ref,contribution,status,skills,links[]{label,href}}',{keys:allKeys}),
    raw.fetch('*[_type == "candidateEvidence" && migration.sourceKey in $keys]{_id,_rev,title,kind,organisation,body,sources[]{title,url},"sourceKey":migration.sourceKey}',{keys:plan.sources.map(row=>row.key)}),
  ]);
  required(settings,'Published CV settings are missing.');
  const promptOld=settings.prompt===V4_CV_WRITER_PROMPT && settings.verifierPrompt===V4_CV_VERIFIER_PROMPT;
  const promptNew=settings.prompt===DEFAULT_CV_WRITER_PROMPT && settings.verifierPrompt===DEFAULT_CV_VERIFIER_PROMPT;
  required(promptOld||promptNew,'Published CV prompts were edited; preserve the editorial values and review manually.');
  required(!docs.some(doc=>doc._id.startsWith('drafts.')) && !sourceDocs.some(doc=>doc._id.startsWith('drafts.')),
    'Publish or discard related Studio drafts before changing CV contributions.');
  const byKey=new Map(docs.map(doc=>[doc.seedKey,doc]));
  const bySource=new Map(sourceDocs.map(doc=>[doc.sourceKey,doc]));
  required(byKey.size===docs.length && bySource.size===sourceDocs.length,'Duplicate CV contribution seed keys need editorial review.');
  required([...oldProjectKeys,...oldProjectEvidenceKeys,...oldOverviewKeys,...oldOverviewEvidenceKeys,
    'extra:critical-onall'].every(key=>byKey.has(key)),
    'The approved project or role anchors are missing.');
  const draftIds=[settings._id,page._id,career._id,...docs.map(doc=>doc._id),...sourceDocs.map(doc=>doc._id)]
    .map(id=>`drafts.${id}`);
  const drafts=await raw.fetch('*[_id in $ids]{_id}',{ids:draftIds});
  required(!drafts.length,'Publish or discard related Studio drafts before changing CV contributions.');

  const ids=new Map([...byKey].map(([key,doc])=>[key,doc._id]));
  const sourceIds=new Map([...bySource].map(([key,doc])=>[key,doc._id]));
  const createSources=plan.sources.filter(row=>!bySource.has(row.key));
  const createRows=newKeys.filter(key=>!byKey.has(key));
  for(const row of createSources)sourceIds.set(row.key,`application-cv-${randomUUID()}`);
  for(const key of createRows)ids.set(key,`application-cv-${randomUUID()}`);
  for(const row of plan.sources){
    const doc=bySource.get(row.key);
    if(!doc)continue;
    required(doc._type==='candidateEvidence' || !doc._type,`Source ${row.key} has the wrong type.`);
    required(doc.title===row.value.title && doc.kind===row.value.kind &&
      plainText(doc.body||[])===row.passage &&
      (!row.value.organisation || doc.organisation===row.value.organisation) &&
      (!row.value.sources || Array.isArray(doc.sources) && doc.sources.length===row.value.sources.length &&
        doc.sources.every((source,index)=>source?.title===row.value.sources[index].title &&
          source?.url===row.value.sources[index].url)),
    `Source ${row.key} was edited; preserve it and review manually.`);
  }
  const patchRows=[];
  for(const [key,title] of oldTitles){
    const doc=byKey.get(key),isFit=key==='project:fit';
    const order=oldProjectKeys.indexOf(key);
    required(doc._type==='applicationCvProject' && [title,isFit?'Independent work':title].includes(doc.title) &&
      doc.dates==='' && doc.location==='' && doc.order===order && !(doc.links||[]).length &&
      (isFit ? doc.approvedPublic===true : typeof doc.approvedPublic==='boolean'),
    `Project ${key} was edited; preserve it and review manually.`);
    if(isFit && doc.title!=='Independent work')patchRows.push({doc,fields:{title:'Independent work'},key});
    if(!isFit && doc.approvedPublic!==false)patchRows.push({doc,fields:{approvedPublic:false},key});
  }
  for(const [index,key] of oldProjectEvidenceKeys.entries()){
    const doc=byKey.get(key),projectKey=oldProjectKeys[index],isFit=index===0,isFigma=index===1;
    const passage=index<2?fitPassage:educationPassage;
    const expectedText=isFit?fitPassage.slice(0,fitPassage.indexOf(' Open source includes figma-graphql')):
      isFigma?'Open source includes figma-graphql, a GraphQL wrapper for the Figma API.':
        `Speaker at ${['React Advanced London','GraphQL Conf','Design Systems London'][index-2]}.`;
    required(doc._type==='applicationCvEvidence' && doc.text===expectedText && doc.sourcePassage===passage &&
      doc.sourceRef===page._id && doc.projectRef===ids.get(projectKey) && doc.order===0 &&
      doc.contribution===(isFit?'strategy':'personal') && doc.status==='delivered' &&
      doc.approvedPublic===true && !(doc.skills||[]).length,
    `Project evidence ${key} was edited; preserve it and review manually.`);
  }
  const roleAnchors=new Map([
    ['role:connect-coimbra','extra:connect-business'],['role:edited','public:edited:0'],
    ['role:travelrepublic','public:travelrepublic:0'],['role:critical-software','extra:critical-onall'],
  ]);
  const oldRoleFacts=new Map([
    ['extra:connect-business',{text:'Co-founded and ran Connect Coimbra, a coworking business in Coimbra.',
      sourceId:career._id,passage:passageContaining(career.body,'Founder, Connect Coimbra + freelance'),roleKey:'role:connect-coimbra'}],
    ['public:edited:0',{text:'Built the React data-visualisation product and design system with the design team. Later took end-to-end ownership of the public website.',
      sourceId:page._id,passage:'Built the React data-visualisation product and design system with the design team. Later took end-to-end ownership of the public website.',roleKey:'role:edited'}],
    ['public:travelrepublic:0',{text:'Led the mobile-first Next.js PWA shared by TravelRepublic, Emirates Holidays and Dnata Travel, coordinating application, design-system and API work.',
      sourceId:page._id,passage:'Led the mobile-first Next.js PWA shared by TravelRepublic, Emirates Holidays and Dnata Travel, coordinating application, design-system and API work.',roleKey:'role:travelrepublic'}],
  ]);
  for(const [key,expected] of oldRoleFacts){
    const doc=byKey.get(key);
    required(doc._type==='applicationCvEvidence' && doc.text===expected.text &&
      doc.sourceRef===expected.sourceId && doc.sourcePassage===expected.passage &&
      doc.roleRef===ids.get(expected.roleKey) && doc.approvedPublic===true && doc.status==='delivered',
    `Approved role overview ${key} was edited; preserve it and review manually.`);
  }
  const roleFacts=new Map([
    ['role:connect-coimbra',['Co-founder','Connect Coimbra','2010 – 2014']],
    ['role:edited',['Senior Engineer','EDITED','2014 – 2018']],
    ['role:travelrepublic',['Principal Engineer','TravelRepublic / Emirates Group','2018 – 2020']],
    ['role:critical-software',['Junior Engineer','Critical Software','2009 – 2010']],
  ]);
  for(const roleKey of oldOverviewKeys){
    const role=byKey.get(roleKey),target=roleKey==='role:critical-software'?ids.get('extra:critical-onall'):
      ids.get(rowKey(`overview:${roleKey.slice(5)}`));
    const old=ids.get(roleAnchors.get(roleKey));
    const [title,company,dates]=roleFacts.get(roleKey);
    required(role._type==='applicationCvRole' && role.approvedPublic===true &&
      role.title===title && role.company===company && role.dates===dates &&
      (role.overviewId===old || role.overviewId===target),
    `Role ${roleKey} overview was edited; preserve it and review manually.`);
    if(target && role.overviewId!==target)patchRows.push({doc:role,fields:{overviewEvidence:ref(target)},key:roleKey});
  }
  const critical=byKey.get('extra:critical-onall');
  required(critical._type==='applicationCvEvidence' && critical.approvedPublic===true && critical.status==='delivered' &&
    critical.roleRef===ids.get('role:critical-software') &&
    critical.sourceRef===career._id &&
    (critical.text==='Built the web interface for onAll, a wearable real-time sensor system for elderly care.' ||
      critical.text===plan.criticalSummary) &&
      critical.sourcePassage===passageContaining(career.body,'Junior Engineer, Critical Software'),
  'Critical Software approved evidence was edited; preserve it and review manually.');
  if(critical.text!==plan.criticalSummary)patchRows.push({doc:critical,fields:{text:plan.criticalSummary},key:'extra:critical-onall'});
  for(const row of plan.roleEvidence){
    const doc=byKey.get(row.key);
    if(!doc)continue;
    const source=plan.sources.find(item=>item.key===row.sourceKey);
    required(doc._type==='applicationCvEvidence' && doc.text===row.text && doc.sourcePassage===source.passage &&
      doc.roleRef===ids.get(row.roleKey) && doc.sourceRef===sourceIds.get(row.sourceKey) &&
      doc.contribution===row.contribution && doc.status==='delivered' && doc.approvedPublic===true,
    `Role evidence ${row.key} was edited; preserve it and review manually.`);
  }
  for(const project of plan.projects){
    const doc=byKey.get(project.key),evidence=byKey.get(project.key.replace('project:','evidence:'));
    if(doc)required(doc._type==='applicationCvProject' && doc.title===project.title && doc.order===project.order &&
      doc.approvedPublic===true && sameLinks(doc.links||[],project.links),
    `Grouped project ${project.key} was edited; preserve it and review manually.`);
    if(evidence)required(evidence._type==='applicationCvEvidence' && evidence.text===project.text &&
      evidence.sourcePassage===project.passage && evidence.sourceRef===(project.sourceId||sourceIds.get(project.sourceKey)) &&
      evidence.projectRef===ids.get(project.key) && evidence.status==='delivered' && evidence.approvedPublic===true,
    `Grouped evidence for ${project.key} was edited; preserve it and review manually.`);
  }
  const needed=!!(createSources.length||createRows.length||patchRows.length||promptOld);
  const proposal={needed,applied:false,promptUpgrade:promptOld,createSources:createSources.map(r=>r.key),createRecords:createRows,
    patchRecords:patchRows.map(r=>r.key),proposedRoleOverviews:plan.roleEvidence.map(r=>({role:r.roleKey,text:r.text})),
    proposedProjects:plan.projects.map(r=>({title:r.title,text:r.text,links:r.links.map(link=>link.href)}))};
  if(!apply)return proposal;
  if(needed){
    const tx=client.transaction();
    for(const row of createSources)tx.create({_id:sourceIds.get(row.key),...row.value});
    for(const row of plan.roleEvidence)if(createRows.includes(row.key))tx.create({_id:ids.get(row.key),_type:'applicationCvEvidence',
      seedKey:row.key,text:row.text,source:ref(sourceIds.get(row.sourceKey)),
      sourcePassage:plan.sources.find(item=>item.key===row.sourceKey).passage,role:ref(ids.get(row.roleKey)),
      contribution:row.contribution,status:'delivered',skills:[],order:300,approvedPublic:true});
    for(const project of plan.projects){
      if(createRows.includes(project.key))tx.create({_id:ids.get(project.key),_type:'applicationCvProject',seedKey:project.key,
        title:project.title,dates:'',location:'',order:project.order,links:project.links,approvedPublic:true});
      const evidenceKey=project.key.replace('project:','evidence:');
      if(createRows.includes(evidenceKey))tx.create({_id:ids.get(evidenceKey),_type:'applicationCvEvidence',seedKey:evidenceKey,
        text:project.text,source:ref(project.sourceId||sourceIds.get(project.sourceKey)),sourcePassage:project.passage,
        project:ref(ids.get(project.key)),contribution:'personal',status:'delivered',skills:[],order:0,approvedPublic:true});
    }
    for(const row of patchRows)tx.patch(row.doc._id,patch=>patch.ifRevisionId(row.doc._rev).set(row.fields));
    if(promptOld)tx.patch(settings._id,patch=>patch.ifRevisionId(settings._rev).set({
      prompt:DEFAULT_CV_WRITER_PROMPT,verifierPrompt:DEFAULT_CV_VERIFIER_PROMPT}));
    await tx.commit({visibility:'sync'});
  }
  return {...proposal,needed:false,applied:needed};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await updateApplicationCvContributions({apply:process.argv.includes('--apply')}),null,2));
