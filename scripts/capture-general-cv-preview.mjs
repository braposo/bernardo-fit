import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdir,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {generalCvPage} from '../tests/fixtures/general-cv-public-page.mjs';

const baseline=process.env.GENERAL_CV_BASELINE==='1';
const baselineRevision=process.env.GENERAL_CV_BASE_REVISION||'8595d4761261cb7fa7b88c75165204d4b6d7d33a';
const baselineModule=join(process.cwd(),'api','site.general-cv-capture-base.mjs');
if(baseline) await writeFile(baselineModule,execFileSync('git',['show',baselineRevision+':api/site.js'],{encoding:'utf8'}));
const siteModule=baseline?await import(pathToFileURL(baselineModule).href+'?capture='+Date.now()):await import('../api/site.js');
const createSiteHandler=siteModule.createSiteHandler;
const handler=createSiteHandler(()=>({fetch:async()=>generalCvPage}));
const server=createServer((req,res)=>{
  handler({method:req.method,query:{page:new URL(req.url,'http://localhost').pathname.slice(1)}},{
    setHeader:(name,value)=>res.setHeader(name,value),
    status(code){res.statusCode=code;return this;},
    send(body){res.end(body);return this;},
    end(){res.end();return this;},
  }).catch(error=>{res.statusCode=500;res.end(String(error));});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const output=join(process.cwd(),'docs','pr-screenshots','personalised-cv','public-general-cv');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined});
try{
  for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
    await page.goto('http://127.0.0.1:'+server.address().port+'/cv',{waitUntil:'networkidle'});
    await page.evaluate(()=>document.fonts.ready);
    await page.addStyleTag({content:'html body,html body *{font-family:Arial,sans-serif!important;animation:none!important;transition:none!important;caret-color:transparent!important}'});
    const state=await page.evaluate(()=>({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}));
    if(state.scrollWidth>state.width) throw new Error('Public general CV overflows at '+width+': '+JSON.stringify(state));
    if(baseline){
      const hasLegacyControl=await page.locator('#print').count()===1;
      if(!hasLegacyControl) throw new Error('Baseline legacy CV should retain its Save as PDF control.');
    }else{
      const href=await page.locator('nav.download a').getAttribute('href');
      if(href!=='/bernardo-raposo-cv.pdf') throw new Error('Updated general CV must link to the canonical PDF path.');
      if(await page.locator('#fit-link').getAttribute('href')!=='https://fit.bernardoraposo.com/') throw new Error('General CV footer must link to the public site.');
    }
    await page.screenshot({path:join(output,(baseline?'before':'after')+'-'+name+'.png'),fullPage:true,animations:'disabled'});
    await page.close();
  }
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  if(baseline) await unlink(baselineModule);
}
console.log('Captured '+(baseline?'base '+baselineRevision:'updated')+' synthetic public general CV screenshots at '+output);
