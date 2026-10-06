// PR comparison fixture for the public application documents: the personalised
// fit page, the application/general CV and the cover letter. Synthetic facts
// only; no Sanity, Trigger or model credentials are needed.
//
// Usage: node scripts/capture-document-design.mjs <before|after> [repoRoot]
// Capture "before" from a checkout of the base revision by passing its root.
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const label=process.argv[2]==='before'?'before':'after';
const root=resolve(process.argv[3]||process.cwd());
const output=join(process.cwd(),'docs','pr-screenshots','document-design');
const load=path=>import(pathToFileURL(join(root,path)).href);
process.chdir(root); // The CV renderer resolves bundled fonts from the working directory.
const {renderPublicApplication}=await load('lib/handlers/application.js');
const {renderApplicationCvHtml}=await load('lib/application-cv-render.js');
const {cvHeader}=await load('lib/sanity/public-pages.js');

const identity={name:'Alex Morgan',headline:'Engineering Manager and hands-on frontend leader',contacts:[
  {label:'Leeds, West Yorkshire',href:''},
  {label:'alex@example.test',href:'mailto:alex@example.test'},
  {label:'linkedin.com/in/alex-example',href:'https://linkedin.example.test/alex'},
  {label:'github.com/alex-example',href:'https://github.example.test/alex'},
  {label:'020 7946 0018',href:'tel:+442079460018'},
]};
const cv={identity,summary:'Engineering leader with fifteen years building customer-facing web platforms. I work as a player-coach: setting frontend architecture and standards, writing decision records and staying close to the code while hiring and growing engineers.',
  experience:[
    {title:'Engineering Manager',company:'Atlas Systems',dates:'2020–2025',location:'Remote',bullets:[
      {text:'Led the web team owning the marketing site, documentation platform, content infrastructure and customer-facing assistant products, as both line manager and technical lead.'},
      {text:'Replatformed marketing surfaces onto a headless content system and module-based architecture, aligning web, marketing, docs and product on one shared direction.'},
      {text:'Owned cross-surface performance, security and analytics, embedding those concerns into standards and code review rather than one-off projects.'},
      {text:'Shipped an assistant used across the website, docs and cloud portal, owning authentication, transport and security hardening.'}]},
    {title:'Principal Engineer',company:'Meridian Travel',dates:'2018–2020',location:'London',bullets:[
      {text:'Led a full platform rewrite of a high-traffic travel site as a mobile-first progressive web app shared across three brands.'},
      {text:'Built the shared design system and a GraphQL layer connecting the frontend to booking and inventory systems.'}]},
    {title:'Senior Engineer',company:'Northbridge Analytics',dates:'2014–2018',location:'London',bullets:[
      {text:'Built core features of a data-analytics product for major retailers and created the design system from scratch with the design team.'},
      {text:'Moved into owning the public website end to end, working across engineering, design and marketing.'}]},
    {title:'Co-founder',company:'Harbour Coworking',dates:'2010–2014',location:'Porto',bullets:[
      {text:'Founded, grew and sold a profitable coworking business while freelancing as a frontend developer for agencies.'}]},
  ],
  education:[{title:'MSc Informatics Engineering',company:'Northbridge University',dates:'2004–2009',location:'',bullets:[]}],
  projects:[
    {title:'Open source',bullets:[{text:'Created React interface tools, a GraphQL wrapper and an experimental data application with over a thousand stars combined.'}],links:[
      {label:'Interface toolkit',href:'https://example.test/toolkit'},{label:'GraphQL wrapper',href:'https://example.test/graphql'}]},
    {title:'Speaking',bullets:[{text:'Spoke at international conferences about React, GraphQL and design systems.'}]},
  ]};
const report={job_title:'Engineering Manager, Web Platform',company:'Northstar Labs',
  pitch:'I lead small web teams as a player-coach, and this role looks like the work I do best: owning a customer-facing platform end to end while growing the people who build it.',
  categories:[
    {name:'Leading the team',note:'Five years managing a web team as both line manager and technical lead, hiring, coaching and promoting engineers while keeping delivery predictable.'},
    {name:'Platform ownership',note:'Owned a marketing site, documentation platform and content infrastructure together, with performance, security and analytics treated as standards rather than projects.'},
    {name:'Hands-on depth',note:'Still close to the code in React, TypeScript and Next.js, which keeps architecture decisions grounded in what the team actually ships.'}],
  differentiators:[
    {headline:'Cross-functional range',detail:'Years spent working across engineering, design, product and marketing, so I translate between them rather than escalate between them.'},
    {headline:'Design systems from scratch',detail:'Built two design systems with designers, from tokens to shared components, used across several brands.'},
    {headline:'Founder perspective',detail:'Started, ran and sold a small business, which shapes how I weigh cost, scope and timing.'}]};
const letter={salutation:'Dear Northstar Labs team,',company:'Northstar Labs',paragraphs:[
  {lead:true,html:'I lead small web teams as a <span class="em">player-coach</span>, and your Engineering Manager role reads like the work I do best.'},
  {html:'For the last five years I have managed the web team at Atlas Systems, owning the marketing site, the documentation platform and the content infrastructure behind them. I hire, coach and promote engineers, and I still write code, which keeps <em>architecture decisions</em> honest.'},
  {html:'Before that I led a full platform rewrite at Meridian Travel, shared across three brands, and built the design system and GraphQL layer that connected it to booking and inventory. Earlier still, I founded and sold a coworking business, so I think about cost and timing as well as craft.'},
  {html:'I live in Leeds and the hybrid pattern you describe works well for me. I would welcome a conversation about the team and the work ahead.'}]};

const fixture={publicId:'synthetic-preview',version:{content:cv},report};
const pages={
  fit:renderPublicApplication(fixture,await readFile(join(root,'lib/templates/application.html'),'utf8')),
  cv:await renderApplicationCvHtml({...cv,fitUrl:'https://fit.example.test/fit/synthetic-preview'}),
  'general-cv':await renderApplicationCvHtml({...cv,variant:'general',publicUrl:'https://fit.example.test/'},{showDownload:true}),
  letter:(await readFile(join(root,'lib/templates/letter.html'),'utf8'))
    .replace('/* SANITY_CV_CONTENT */',`window.PUBLIC_CV=${JSON.stringify({name:identity.name,signature:'alex@example.test · linkedin.com/in/alex-example'})};`)
    .replace('<!-- SANITY_LETTER_HEADER -->',cvHeader({name:identity.name,headline:identity.headline,contacts:identity.contacts})),
};
const shots=[
  ['fit','desktop',1280,900,'screen'],['fit','mobile',390,844,'screen'],
  ['cv','a4',794,1123,'print'],['general-cv','mobile',390,844,'screen'],
  ['letter','desktop',1280,1200,'screen'],['letter','mobile',390,844,'screen'],
];
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined});
try{
  for(const [name,size,width,height,media] of shots){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
    await page.emulateMedia({media});
    await page.route('https://preview.test/**',route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/api/letter')return route.fulfill({json:letter});
      return route.fulfill({contentType:'text/html; charset=utf-8',body:pages[name]});
    });
    await page.goto(`https://preview.test/${name}?j=synthetic&t=synthetic`,{waitUntil:'networkidle'});
    await page.evaluate(()=>document.fonts.ready);
    await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'});
    await page.waitForTimeout(300);
    await page.screenshot({path:join(output,`${name}-${size}-${label}.png`),fullPage:media==='screen',animations:'disabled'});
    await page.close();
  }
}finally{await browser.close();}
console.log(`Captured ${label} document previews in ${output}`);
