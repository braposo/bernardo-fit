// A published-source query result for the two-page CV, built from the agreed
// seed content with synthetic contacts and source revisions.
import {TWO_PAGE_PROFILE,TWO_PAGE_ROLES,TWO_PAGE_FEATURED,TWO_PAGE_CONTRIBUTIONS,TWO_PAGE_CV_PROMPT} from '../../scripts/two-page-cv-content.mjs';

const source={_id:'two-page-source',_rev:'rev-source'};
const fact=(id,text,extra={})=>({_id:id,_rev:`rev-${id}`,text,sourcePassage:text,source,contribution:'personal',status:'delivered',skills:[],...extra});
const ROLE_FACTS=[
  ['singlestore','Engineering Manager','SingleStore','Aug 2020 – May 2026','Remote, UK | Database'],
  ['travelrepublic','Principal Engineer','TravelRepublic / Emirates Group','2018 – 2020','London, UK | Travel ecommerce'],
  ['edited','Senior Engineer','EDITED','2014 – 2018','London, UK | Retail analytics'],
  ['connect-coimbra','Co-founder and freelance web developer','Connect Coimbra','2010 – 2014','Coimbra, Portugal'],
  ['critical-software','Junior Engineer','Critical Software','2009 – 2010','Coimbra, Portugal'],
];

export function twoPageCvDocument({layout='detailed',pages=2}={}) {
  const roles=ROLE_FACTS.map(([key,title,company,dates,location],order)=>{
    const content=TWO_PAGE_ROLES[key];
    const overview=fact(`${key}-overview`,content.scope);
    const achievements=content.achievements.map(item=>fact(`${key}-${item.key}`,item.text,{contribution:item.contribution}));
    return {_id:`role-${key}`,_rev:`rev-role-${key}`,title,company,dates,location,order,overviewEvidenceId:overview._id,
      depth:content.depth,scope:content.scope,responsibilities:content.responsibilities,achievementIds:achievements.map(item=>item._id),
      stack:content.stack,domains:content.domains,evidence:[overview,...achievements]};
  });
  const project=(id,title,order,links,extra={})=>({_id:id,_rev:`rev-${id}`,title,dates:'',location:'',order,links,
    evidence:[fact(`${id}-fact`,`${title} approved fact.`)],...extra});
  return {
    page:{_id:'cv-page',_rev:'rev-page',cv:{name:'Bernardo Raposo',headline:'Engineering manager and generalist engineer',
      contacts:[{label:'hello@example.test',href:'mailto:hello@example.test'},{label:'example.test',href:'https://example.test/'}]}},
    settings:{_id:'application-cv-settings',_rev:'rev-settings',model:'gpt-5.6-sol',prompt:'Write.',verifierPrompt:'Verify.',maxWords:620,minBodyPx:13,
      layout,pages,detailedPrompt:TWO_PAGE_CV_PROMPT},
    profile:{_id:'application-cv-profile',_rev:'rev-profile',...structuredClone(TWO_PAGE_PROFILE)},
    roles,
    education:[{_id:'education',_rev:'rev-education',title:'MSc and BSc in Informatics Engineering',dates:'2002 – 2009',location:'University of Coimbra, Portugal',order:0,
      evidence:[fact('education-fact','MSc and BSc in Informatics Engineering, University of Coimbra.')]}],
    projects:[
      project('fit','Fit',0,[{label:'fit.bernardoraposo.com',href:'https://fit.example.test/'}],{featured:true,dates:TWO_PAGE_FEATURED.dates,
        scope:TWO_PAGE_FEATURED.scope,highlights:TWO_PAGE_FEATURED.highlights,stack:TWO_PAGE_FEATURED.stack,domains:TWO_PAGE_FEATURED.domains}),
      project('hermans','Hermans Club',1,[{label:'hermans.club',href:'https://hermans.example.test/'}],{summary:TWO_PAGE_CONTRIBUTIONS['project:hermans']}),
      project('open-source','Open source',2,['react-text-loop','react-responsive-picture','figma-graphql','nextjs-solana-starter-kit']
        .map(label=>({label,href:`https://github.example.test/${label}`})),{summary:TWO_PAGE_CONTRIBUTIONS['contributions:project:open-source:v5']}),
      project('speaking','Speaking',3,[{label:'React Advanced London · 2019',href:'https://talks.example.test/1'},{label:'GraphQL Conf · 2019',href:'https://talks.example.test/2'},
        {label:'Design Systems London · 2019',href:'https://talks.example.test/3'}],{summary:TWO_PAGE_CONTRIBUTIONS['contributions:project:speaking:v5']}),
    ],
  };
}
