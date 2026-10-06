import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {generalCvContent} from '../tests/fixtures/general-cv-public-page.mjs';
import {renderApplicationCvHtml,renderApplicationCvPdf} from '../lib/application-cv-render.js';

const label=process.argv[2];
assert.ok(['before','after'].includes(label));
const output='docs/pr-screenshots/cv-spacing-links';
await mkdir(output,{recursive:true});
const content=structuredClone(generalCvContent);
content.projects=[
 {title:'Side project',bullets:[{text:'Built a small application for independent teams.'}],links:[{label:'project.example.test',href:'https://project.example.test/'}]},
 {title:'Open source',bullets:[{text:'Published interface components and an application starter kit.'}],links:['react-component','responsive-picture','design-graphql','Community Labs · nextjs-starter-kit'].map((label,i)=>({label,href:'https://example.test/repository/'+i}))},
 {title:'Speaking',bullets:[{text:'Presented at three engineering conferences.'}],links:['React Conference · 2019','GraphQL Conf · 2019','Design Systems London · 2019'].map((label,i)=>({label,href:'https://example.test/talk/'+i}))}
];
const html=await renderApplicationCvHtml(content,{showDownload:true});
const browser=await chromium.launch({headless:true});
const metrics={};
try {
  for(const [name,width,height,media] of [['desktop',1280,1200,'screen'],['tablet',768,1024,'screen'],['mobile',390,844,'screen'],['narrow',360,844,'screen'],['a4',794,1123,'print']]) {
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
    await page.emulateMedia({media});
    await page.setContent(html);
    await page.evaluate(async()=>{await Promise.all([...document.fonts].map(face=>face.load()));await document.fonts.ready;});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    metrics[name]=await page.evaluate(()=>({
      width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,
      blocks:[...document.querySelectorAll('header,section,footer')].map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}),
    }));
    assert.ok(metrics[name].scrollWidth<=width);
    await page.screenshot({path:`${output}/${label}-${name}.png`,fullPage:true,animations:'disabled'});
    await page.close();
  }
} finally {await browser.close();}
await writeFile(`${output}/${label}-metrics.json`,JSON.stringify(metrics,null,2)+'\n');

const {pdfBytes}=await renderApplicationCvPdf(content);
await mkdir('tmp/pdfs/cv-spacing-links',{recursive:true});
await writeFile(`tmp/pdfs/cv-spacing-links/${label}.pdf`,pdfBytes);
console.log(`${label}: captured five sizes, validated one-page PDF`);
