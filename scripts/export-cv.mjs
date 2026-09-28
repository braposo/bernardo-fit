// Export only the master CV. No generation, artifact publication or uploads.
// A supplied source file must contain a public sitePage with cv fields.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {createContentClient} from '../lib/sanity/client.js';
import {PUBLIC_PAGE_QUERY} from '../lib/sanity/public-pages.js';
import {createSiteHandler} from '../api/site.js';

const args = process.argv.slice(2);
function option(name) { const i=args.indexOf(name); if(i<0)return ''; if(!args[i+1] || args[i+1].startsWith('--'))throw Error(`Missing ${name} value`); return args[i+1]; }
const sourcePath=option('--source');
const output=resolve(option('--output') || 'output/pdf/bernardo-raposo-cv.pdf');
const page=sourcePath ? JSON.parse(await readFile(resolve(sourcePath),'utf8'))
  : await createContentClient().fetch(PUBLIC_PAGE_QUERY, {slug:'cv'});
if(!page?.cv?.name || !page.cv.sections?.length)throw Error('A populated public CV source is required.');
let html='', status;
const res={setHeader(){},status(code){status=code;return this;},send(body){html=body;return this;},end(){return this;}};
await createSiteHandler(()=>({fetch:async()=>page}))({method:'GET',query:{page:'cv'}},res);
if(status!==200)throw Error('The CV template did not render.');
// A document export never executes application or tracking scripts.
html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
// Embed the template's fonts so the PDF cannot silently use fallback metrics.
// Requests are limited to the public font hosts; candidate content is not sent.
const fontLink=html.match(/<link\b[^>]*href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"[^>]*>/);
if(!fontLink)throw Error('The document font stylesheet is missing.');
const stylesheet=await fetch(fontLink[1],{signal:AbortSignal.timeout(30000)});
if(!stylesheet.ok)throw Error('Could not download the document font stylesheet.');
let fontCss=await stylesheet.text();
const fontUrls=[...new Set([...fontCss.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m=>m[1]))];
if(!fontUrls.length)throw Error('No document fonts were found.');
const fontData=await Promise.all(fontUrls.map(async url=>{
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Could not download a document font.');
  return [url,`data:${response.headers.get('content-type') || 'font/ttf'};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`];
}));
for(const [url,data] of fontData)fontCss=fontCss.replaceAll(url,data);
html=html.replace(fontLink[0],()=>`<style>${fontCss}</style>`);
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined});
try {
  const sheet=await browser.newPage({viewport:{width:1280,height:1200}});
  await sheet.emulateMedia({media:'print'});
  await sheet.setContent(html,{waitUntil:'networkidle'});
  await sheet.evaluate(()=>document.fonts.ready);
  const layout=await sheet.evaluate(()=>{
    const page=document.querySelector('#page'),end=page.querySelector('section:last-child');
    const style=getComputedStyle(page);
    return {overflow:end.getBoundingClientRect().bottom-(page.getBoundingClientRect().bottom-parseFloat(style.paddingBottom)),
      bodyPixels:parseFloat(style.fontSize), fontsReady:document.fonts.check('400 13px "IBM Plex Sans"') && document.fonts.check('700 32px "Schibsted Grotesk"')};
  });
  if(!layout.fontsReady)throw Error('Required document fonts failed to load; retry before exporting.');
  if(layout.overflow>2)throw Error(`CV exceeds one A4 page by ${Math.ceil(layout.overflow)}px. Shorten the source before exporting.`);
  if(layout.bodyPixels<13)throw Error('CV body is below the agreed readable size.');
  await mkdir(dirname(output),{recursive:true});
  const pdf=await sheet.pdf({path:output,format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:false,tagged:true});
  const manifest={exportedAt:new Date().toISOString(),sourceMode:sourcePath?'local-proposal':'published-sanity',sourceId:page._id||null,sourceRevision:page._rev||null,
    cvSha256:createHash('sha256').update(JSON.stringify(page.cv)).digest('hex'),
    pdfSha256:createHash('sha256').update(pdf).digest('hex'),layout};
  await writeFile(output+'.json',JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({output,...manifest},null,2));
} finally {await browser.close();}
