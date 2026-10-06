// PR comparison fixture: synthetic role and CV facts; no Sanity credentials required.
import {readFile,mkdir,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';

const baseline=process.env.APP_PREVIEW_BASELINE==='1';
const baselineModule=join(process.cwd(),'lib','handlers','application.capture-base.mjs');
if(baseline) await writeFile(baselineModule,execFileSync('git',['show','146d45c:lib/handlers/application.js'],{encoding:'utf8'}));
const {renderPublicApplication}=await import(baseline?'../lib/handlers/application.capture-base.mjs':'../lib/handlers/application.js');

const content={identity:{name:'Alex Morgan',headline:'Engineering leader building dependable product platforms',contacts:[{label:'alex@example.test',href:'mailto:alex@example.test'}]},summary:'',
  experience:[
    {title:'Engineering Manager',company:'Atlas Systems',dates:'2021–2025',location:'Remote',bullets:[{text:'Led a small team delivering shared platform tools for product and support teams.'},{text:'Set technical direction and coached engineers through project delivery.'}]},
    {title:'Principal Engineer',company:'Meridian Travel',dates:'2017–2021',location:'London',bullets:[{text:'Built a shared web platform used by multiple travel brands.'}]},
  ],
  education:[{title:'BSc Computer Science',company:'Northbridge University',dates:'2006–2009',location:'',bullets:[]}],
  projects:[{title:'Open-source accessibility toolkit',company:'',dates:'2024',location:'',bullets:[{text:'Created reusable interface checks for product teams.'}]}]};
const fixture={publicId:'synthetic-preview',version:{content},report:{job_title:'Engineering Manager',company:'Northstar Labs',
  pitch:'I bring a mix of team leadership, platform decisions and hands-on web experience to this role.',
  categories:[{name:'Leadership',note:'Led a small product engineering team.'},
    {name:'Technical direction',note:'Built shared platform foundations for multiple teams.'}],
  differentiators:[{headline:'Cross-functional delivery',detail:'Work spanning engineering, design, product and content teams.'}],
  closing:'I would welcome a conversation about the team and the work ahead.'}};
const template=baseline
  ? execFileSync('git',['show','146d45c:lib/templates/application.html'],{encoding:'utf8'})
  : await readFile(new URL('../lib/templates/application.html',import.meta.url),'utf8');
const html=renderPublicApplication(fixture,template);
const output=join(process.cwd(),'docs','pr-screenshots','personalised-cv');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined});
try{
  for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
    await page.setContent(html,{waitUntil:'networkidle'});
    await page.evaluate(()=>document.fonts.ready);
    await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'});
    await page.screenshot({path:join(output,`public-${baseline?'before':'after'}-${name}.png`),fullPage:true,animations:'disabled'});
    await page.close();
  }
}finally{await browser.close();if(baseline)await unlink(baselineModule);}
console.log(`Captured ${baseline?'base':'updated'} synthetic public page at ${output}`);
