// PR comparison fixture: synthetic role, published approved CV facts.
import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {loadApplicationCvSource} from '../lib/application-cv-source.js';
import {renderPublicApplication} from '../lib/handlers/application.js';

const source=await loadApplicationCvSource(null);
const content={identity:source.identity,summary:'',
  experience:source.roles.map(role=>({title:role.title,company:role.company,dates:role.dates,location:role.location,
    bullets:role.evidence.filter(e=>e.status==='delivered').slice(0,role.company==='SingleStore'?2:1).map(e=>({text:e.text}))})),
  education:source.education.map(row=>({title:row.title,company:'',dates:row.dates,location:row.location,bullets:row.evidence.slice(0,1).map(e=>({text:e.text}))})),
  projects:source.projects.map(row=>({title:row.title,company:'',dates:row.dates,location:row.location,bullets:row.evidence.slice(0,1).map(e=>({text:e.text}))}))};
const fixture={publicId:'synthetic-preview',version:{content},report:{job_title:'Engineering Manager',company:'Northstar Labs',
  pitch:'I bring a mix of team leadership, platform decisions and hands-on web experience to this role.',
  categories:[{name:'Leadership',note:'Led the SingleStore Web team across its website, documentation platform and AI products.'},
    {name:'Technical direction',note:'Built shared platform foundations at TravelRepublic and design systems across different teams.'}],
  differentiators:[{headline:'Cross-functional delivery',detail:'Work spanning engineering, design, product and content teams.'}],
  closing:'I would welcome a conversation about the team and the work ahead.'}};
const template=await readFile(new URL('../lib/templates/application.html',import.meta.url),'utf8');
const html=renderPublicApplication(fixture,template);
const output=join(process.cwd(),'docs','pr-screenshots','personalised-cv');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined});
try{
  for(const [name,width,height] of [['public-desktop',1280,900],['public-mobile',390,844]]){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
    await page.setContent(html,{waitUntil:'networkidle'});
    await page.evaluate(()=>document.fonts.ready);
    await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'});
    await page.screenshot({path:join(output,`${name}.png`),fullPage:true,animations:'disabled'});
    await page.close();
  }
}finally{await browser.close();}
console.log(`Captured synthetic public page at ${output}`);
