import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {createSiteHandler} from '../api/site.js';
import {renderApplicationCvPdf} from '../lib/application-cv-render.js';
import {generalCvContent,generalCvPage} from './fixtures/general-cv-public-page.mjs';

const {chromium}=createRequire(import.meta.url)('playwright');
let passed=0,failed=0;
try{
const client={fetch:async()=>generalCvPage};
const handler=createSiteHandler(()=>client);
const makeResponse=()=>({code:0,headers:{},body:'',setHeader(name,value){this.headers[name]=value;},
  status(code){this.code=code;return this;},send(body){this.body=body;return this;},end(){return this;}});
const response=makeResponse();
await handler({method:'GET',query:{page:'cv'}},response);
assert.equal(response.code,200,'published general CV route should render');
assert.match(response.headers['Content-Type'],/text\/html/);
assert.match(response.body,/<title>Alex Morgan · CV<\/title>/);
assert.match(response.body,/Engineering Manager/);
assert.match(response.body,/Open-source accessibility toolkit/);
assert.match(response.body,/Other contributions/);
assert.match(response.body,/<a href="\/bernardo-raposo-cv\.pdf">Download CV · PDF<\/a>/,
  'reader download must use the canonical PDF route');
assert.match(response.body,/<footer>More about my work: <a id="fit-link" href="https:\/\/fit\.bernardoraposo\.com\/">/);
assert.doesNotMatch(response.body,/Role fit and supporting analysis|Tailored for|job_title|fitUrl/);
for(const secret of ['private-identity-842','private-role-711','private-evidence-91','private-evidence-92',
  'private-evidence-93','Never render this private instruction','private-source-snapshot-41',
  'private validation note','estimatedCostMicros','candidate profile','versionInstructions','javascript:alert(1)'])
  assert.ok(!response.body.includes(secret),`public HTML must omit ${secret}`);
assert.ok(response.body.includes('Led a small team delivering shared platform tools for product and support teams.'));
assert.ok(response.body.includes('href="tel:+442079460018"'));
assert.ok(!response.body.includes('href="javascript:'));

// Shared report links open the fit page design: the live application page when the job has one,
// otherwise the report with the published general CV.
const sharedReport={job_title:'Platform Lead',company:'Northstar',pitch:'A synthetic pitch.',closing:'A synthetic closing.',
  categories:[{name:'Leadership',note:'Led a team.'}],differentiators:[{headline:'Range',detail:'Worked across teams.'}],triage:'private triage'};
const sharedHandler=createSiteHandler(()=>client,undefined,{findApplication:async id=>id==='with-cv'?'livepublicid':null,
  getReport:async id=>id==='shared'?sharedReport:null});
const redirected=makeResponse();
await sharedHandler({method:'GET',query:{page:'home',r:'with-cv'}},redirected);
assert.equal(redirected.code,302);assert.equal(redirected.headers.Location,'/fit/livepublicid');
const shared=makeResponse();
await sharedHandler({method:'GET',query:{page:'home',r:'shared'}},shared);
assert.equal(shared.code,200);
assert.match(shared.body,/<title>Platform Lead · Alex Morgan<\/title>/);
for(const fragment of ['The fit','What I bring','A synthetic closing.','Led a small team delivering shared platform tools','href="/bernardo-raposo-cv.pdf"','"shared"'])
  assert.ok(shared.body.includes(fragment),`shared report page is missing ${fragment}`);
assert.doesNotMatch(shared.body,/Application CV|private triage|private-role-711|javascript:alert/);
const missing=makeResponse();
await sharedHandler({method:'GET',query:{page:'home',r:'missing'}},missing);
assert.equal(missing.code,503,'unknown reports fall through to the original home view');

const downloadResponse=makeResponse();
await handler({method:'GET',query:{page:'download'}},downloadResponse);
assert.equal(downloadResponse.code,302,'published general PDF route should redirect');
assert.equal(downloadResponse.headers.Location,generalCvPage.downloadUrl,'download route should resolve the same approved page asset');
const mismatchedPage={...generalCvPage,generalCv:{...generalCvPage.generalCv,pdfAssetId:'different-general-cv-pdf'}};
const mismatchedHandler=createSiteHandler(()=>({fetch:async()=>mismatchedPage}));
const mismatchedResponse=makeResponse();
await mismatchedHandler({method:'GET',query:{page:'download'}},mismatchedResponse);
assert.equal(mismatchedResponse.code,404,'mismatched page and general PDF assets must not be downloadable');

const {pdfBytes,layout}=await renderApplicationCvPdf(generalCvContent,{minBodyPx:13});
assert.ok(layout.fontsReady && layout.bodyPixels>=13,'general CV PDF should use bundled readable fonts');
const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
const loading=pdfjs.getDocument({data:new Uint8Array(pdfBytes),useSystemFonts:false,disableFontFace:true});
const pdf=await loading.promise;
try{
  assert.equal(pdf.numPages,1);
  const page=await pdf.getPage(1);
  const text=(await page.getTextContent()).items.map(item=>item.str||'').join(' ');
  const compact=value=>String(value||'').normalize('NFKC').replace(/\s+/g,'');
  let cursor=0;
  for(const fragment of ['Alex Morgan',generalCvContent.identity.headline,'Engineering Manager','Atlas Systems',
    ...generalCvContent.experience[0].bullets.map(b=>b.text),'BSc Computer Science',
    'Open-source accessibility toolkit','Created reusable interface checks for product teams.','More about my work']){
    const found=compact(text).indexOf(compact(fragment),cursor);
    assert.ok(found>=0,`general PDF is missing or has out-of-order text: ${fragment}`);cursor=found+compact(fragment).length;
  }
  assert.ok(!/Role fit and supporting analysis|Tailored for/i.test(text));
  for(const secret of ['private-role-711','private-evidence-91','private-source-snapshot-41','Never render this private instruction','estimatedCostMicros'])
    assert.ok(!text.includes(secret),`general PDF must omit ${secret}`);
  const annotations=await page.getAnnotations({intent:'display'});
  assert.ok(annotations.some(annotation=>annotation.url===generalCvContent.publicUrl),'PDF must include the canonical public-site link');
}finally{await loading.destroy();}

const server=createServer((req,res)=>{
  handler({method:req.method,query:{page:new URL(req.url,'http://localhost').pathname.slice(1)}},{
    setHeader:(name,value)=>res.setHeader(name,value),
    status(code){res.statusCode=code;return this;},
    send(body){res.end(body);return this;},
    end(){res.end();return this;},
  }).catch(error=>{res.statusCode=500;res.end(String(error));});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined});
try{
  for(const width of [390,360]){
    const page=await browser.newPage({viewport:{width,height:844}});
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
    await page.goto('http://127.0.0.1:'+server.address().port+'/cv',{waitUntil:'networkidle'});
    await page.evaluate(()=>document.fonts.ready);
    const layoutState=await page.evaluate(()=>({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,
      bodyWidth:document.body.scrollWidth,download:document.querySelector('nav.download a')?.getAttribute('href')}));
    assert.ok(layoutState.scrollWidth<=layoutState.width,`public /cv page overflows at ${width}: ${JSON.stringify(layoutState)}`);
    assert.ok(layoutState.bodyWidth<=layoutState.width,`public /cv body overflows at ${width}: ${JSON.stringify(layoutState)}`);
    assert.equal(layoutState.download,'/bernardo-raposo-cv.pdf');
    await page.close();
  }
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}

passed=1;
}catch(error){
  failed=1;
  console.error(error?.stack||error);
}
console.log(`passed ${passed}, failed ${failed}`);
if(failed)process.exitCode=1;
