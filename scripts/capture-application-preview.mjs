// PR comparison fixture: synthetic role and CV facts; no Sanity credentials required.
import {readFile,mkdir,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';

const baseline=process.env.APP_PREVIEW_BASELINE==='1';
const baselineRevision=process.env.APP_PREVIEW_BASE_REVISION||'146d45c';
const stage=process.env.APP_PREVIEW_STAGE||'';
const baselineModule=join(process.cwd(),'lib','handlers','application.capture-base.mjs');
if(baseline) await writeFile(baselineModule,execFileSync('git',['show',`${baselineRevision}:lib/handlers/application.js`],{encoding:'utf8'}));
const {renderPublicApplication}=await import(baseline?'../lib/handlers/application.capture-base.mjs':'../lib/handlers/application.js');

const content={identity:{name:'Alex Morgan',headline:'Engineering leader building dependable product platforms',contacts:[
  {label:'alex@example.test',href:'mailto:alex@example.test'},
  {label:'020 7946 0018',href:'tel:+442079460018'},
]},summary:'',
  experience:[
    {title:'Engineering Manager',company:'Atlas Systems',dates:'2021–2025',location:'Remote',bullets:[{text:'Led a small team delivering shared platform tools for product and support teams.'},{text:'Set technical direction and coached engineers through project delivery.'}]},
    {title:'Principal Engineer',company:'Meridian Travel',dates:'2017–2021',location:'London',bullets:[{text:'Built a shared web platform used by multiple travel brands.'}]},
  ],
  education:[{title:'BSc Computer Science',company:'Northbridge University',dates:'2006–2009',location:'',bullets:[]}],
  projects:[
    {title:'Open-source accessibility toolkit',company:'Community project',dates:'2024',location:'',bullets:[{text:'Created reusable interface checks for product teams.'}]},
    {title:'Conference talk: Building accessible product systems',company:'Product Engineering Summit',dates:'2025',location:'',bullets:[{text:'Shared practical techniques with product teams.'}]},
  ]};
const fixture={publicId:'synthetic-preview',version:{content},report:{job_title:'Engineering Manager',company:'Northstar Labs',
  pitch:'I bring a mix of team leadership, platform decisions and hands-on web experience to this role.',
  categories:[{name:'Leadership',note:'Led a small product engineering team.'},
    {name:'Technical direction',note:'Built shared platform foundations for multiple teams.'}],
  differentiators:[{headline:'Cross-functional delivery',detail:'Work spanning engineering, design, product and content teams.'}],
  closing:'I would welcome a conversation about the team and the work ahead.'}};
const template=baseline
  ? execFileSync('git',['show',`${baselineRevision}:lib/templates/application.html`],{encoding:'utf8'})
  : await readFile(new URL('../lib/templates/application.html',import.meta.url),'utf8');
const html=renderPublicApplication(fixture,template);
if(stage==='projects-speaking') {
  const heading=baseline?'<h3 class="section-label">Projects</h3>':'<h3 class="section-label">Projects &amp; speaking</h3>';
  if(!html.includes(heading) || !html.includes('Open-source accessibility toolkit') || !html.includes('Conference talk: Building accessible product systems'))
    throw new Error(`Unexpected projects/speaking fixture or heading for ${baseline?'base':'updated'} capture.`);
}
if(stage==='clean-layout' && baseline && !content.identity.contacts.some(contact=>contact.href.startsWith('tel:')))
  throw new Error('The clean-layout fixture needs its fictional phone contact.');
const output=join(process.cwd(),'docs','pr-screenshots','personalised-cv',stage);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined});
try{
  for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
    await page.setContent(html,{waitUntil:'networkidle'});
    await page.evaluate(()=>document.fonts.ready);
    await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'});
    if(stage==='projects-speaking') {
      const expected=baseline?'Projects':'Projects & speaking';
      const actual=(await page.locator('.cv .experience > h3.section-label').last().textContent()).trim();
      if(actual!==expected) throw new Error(`Expected visible section heading "${expected}", found "${actual}".`);
    }
    if(stage==='clean-layout' && !baseline) {
      const layout=await page.evaluate(()=>({
        separators:['.rows','.row','.cv','.role','.footer'].flatMap(selector=>[...document.querySelectorAll(selector)].map(element=>{
          const style=getComputedStyle(element);return [style.borderTopWidth,style.borderBottomWidth,style.borderBlockWidth];
        })).every(widths=>widths.every(width=>parseFloat(width)===0)),
        paragraphs:document.querySelectorAll('.role li').length===0 && document.querySelectorAll('.role .entry-detail').length>0,
        phone:[...document.querySelectorAll('.contacts a')].some(link=>link.getAttribute('href')==='tel:+442079460018'),
        soleDownload:document.querySelectorAll('a.download').length===1,
      }));
      if(!layout.separators || !layout.paragraphs || !layout.phone || !layout.soleDownload) throw new Error(`Unexpected clean public CV layout: ${JSON.stringify(layout)}`);
    }
    await page.screenshot({path:join(output,`public-${baseline?'before':'after'}-${name}.png`),fullPage:true,animations:'disabled'});
    await page.close();
  }
}finally{await browser.close();if(baseline)await unlink(baselineModule);}
console.log(`Captured ${baseline?'base '+baselineRevision:'updated'} synthetic public page at ${output}`);
