import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {safeApplicationCvContactHref} from './application-cv-contacts.js';

const fontUrl = name => resolve(process.cwd(),'lib','assets','cv-fonts',name);
const escape = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const safeHref = value => {
  try {
    const url=new URL(String(value));
    return ['https:','http:','mailto:','tel:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {return '';}
};
const clean = value => String(value ?? '').replace(/\s+/g,' ').trim();
// PDF text runs can split a word at every letter on Linux, particularly with
// heading tracking. Compare ordered characters rather than invented run spaces.
const comparable = value => String(value ?? '').normalize('NFKC').replace(/\s+/g,'');
const error = (code,message) => Object.assign(new Error(message),{status:422,code,abort:true});

async function embeddedFonts() {
  const names=['IBMPlexSans-Regular.ttf','IBMPlexSans-SemiBold.ttf','SchibstedGrotesk-Bold.ttf'];
  const fonts=await Promise.all(names.map(async name => (await readFile(fontUrl(name))).toString('base64')));
  return `@font-face{font-family:Plex;src:url(data:font/ttf;base64,${fonts[0]}) format('truetype');font-weight:400}
  @font-face{font-family:Plex;src:url(data:font/ttf;base64,${fonts[1]}) format('truetype');font-weight:600}
  @font-face{font-family:Schibsted;src:url(data:font/ttf;base64,${fonts[2]}) format('truetype');font-weight:700}`;
}

function entryMarkup(entry, className='entry') {
  return `<article class="${className}"><div class="entry-head"><strong>${escape(entry.title)}</strong>
    <span>${escape(entry.dates)}</span></div><div class="entry-meta">${escape(entry.company || entry.location || '')}${entry.company && entry.location ? ' · '+escape(entry.location) : ''}</div>
    ${(entry.bullets || []).map(bullet => `<p class="entry-detail">${escape(bullet.text)}</p>`).join('')}</article>`;
}

export async function renderApplicationCvHtml(content,{minBodyPx=13}={}) {
  const fitUrl=safeHref(content?.fitUrl);
  if (!fitUrl || !/^https?:/.test(fitUrl)) throw error('CV_FIT_URL','A public fit-page URL is required.');
  const bodyPx=Math.max(13,Number(minBodyPx)||13);
  if (!Number.isFinite(bodyPx) || bodyPx>18) throw error('CV_FONT_SIZE','The CV body size is invalid.');
  const contacts=(content.identity?.contacts || []).filter(c => clean(c?.label) && safeApplicationCvContactHref(c?.href))
    .map(c => `<a href="${escape(safeApplicationCvContactHref(c.href))}">${escape(c.label)}</a>`).join('');
  const section=(title,items) => items?.length ? `<section><h2>${escape(title)}</h2>${items.map(item => entryMarkup(item)).join('')}</section>` : '';
  const fontCss=await embeddedFonts();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escape(content.identity?.name)} · CV</title><style>${fontCss}
  @page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#25241f}
  body{font-family:Plex,Arial,sans-serif;font-size:${bodyPx}px;line-height:1.36;font-variant-ligatures:none}
  .page{width:210mm;min-height:297mm;padding:11mm 13mm 10mm;background:white}
  h1{font:700 29px/1.08 Schibsted,Plex,sans-serif;letter-spacing:-.025em;margin:0}
  .headline{font-weight:600;font-size:14px;margin:4px 0 0}.contacts{display:flex;flex-wrap:wrap;gap:2px 10px;margin:5px 0 0;color:#555249;font-size:11px}
  a{color:inherit;text-decoration:none;border-bottom:1px solid #4771a1}.intro{margin:9px 0 0;max-width:170mm}
  section{margin-top:16px}h2{font:600 10px/1.3 Plex,sans-serif;letter-spacing:.095em;text-transform:uppercase;color:#315c8b;margin:0 0 7px}
  .entry{margin:0 0 10px;break-inside:avoid}.entry:last-child{margin-bottom:0}.entry-head{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
  .entry-head strong{font-weight:600}.entry-head span{font-size:11px;white-space:nowrap;color:#5c5a54}.entry-meta{color:#5c5a54;font-size:11px;margin:1px 0 3px}
  .entry-detail{margin:4px 0 0;break-inside:avoid}
  footer{margin-top:18px;font-size:10px;color:#555249}
  @media screen{body{background:#e8e6e1;padding:20px}.page{margin:auto;box-shadow:0 5px 28px #0002}}
  </style></head><body><main class="page" id="cv-page"><header><h1>${escape(content.identity?.name)}</h1>
  <p class="headline">${escape(content.identity?.headline)}</p><div class="contacts">${contacts}</div>
  ${content.summary && content.summary !== content.identity?.headline ? `<p class="intro">${escape(content.summary)}</p>` : ''}</header>
  ${section('Experience',content.experience)}${section('Education',content.education)}${section('Projects & speaking',content.projects)}
  <footer>Role fit and supporting analysis: <a id="fit-link" href="${escape(fitUrl)}">${escape(fitUrl.replace(/^https?:\/\//,''))}</a></footer>
  </main></body></html>`;
}

export async function validateApplicationCvPdf(pdfBytes,{fitUrl,name,content}) {
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading=getDocument({data:new Uint8Array(pdfBytes),useSystemFonts:false,disableFontFace:true});
  const document=await loading.promise;
  try {
    if (document.numPages!==1) throw error('CV_PDF_PAGES',`CV PDF has ${document.numPages} pages; one is required.`);
    const page=await document.getPage(1);
    const text=(await page.getTextContent()).items.map(item => item.str || '').join(' ');
    const extracted = comparable(text);
    if (!extracted.includes(comparable(name)) || !extracted.toLowerCase().includes('experience')) throw error('CV_PDF_TEXT','CV PDF text could not be extracted.');
    if (content) {
      const expected = [content.identity?.name, content.identity?.headline,
        ...(content.identity?.contacts || []).filter(c => clean(c?.label) && safeApplicationCvContactHref(c?.href)).map(c => c.label),
        content.summary !== content.identity?.headline ? content.summary : '',
        ...[...(content.experience || []), ...(content.education || []), ...(content.projects || [])]
          .flatMap(entry => [entry.title, entry.company || entry.location, ...(entry.bullets || []).map(b => b.text)])]
        .filter(Boolean).map(comparable);
      let cursor = 0;
      for (const fragment of expected) {
        const found = extracted.indexOf(fragment, cursor);
        if (found < 0) throw error('CV_PDF_READING_ORDER','CV PDF text is missing or differs from the saved content order.');
        cursor = found + fragment.length;
      }
    }
    const links=await page.getAnnotations({intent:'display'});
    if (!links.some(link => link.url === fitUrl)) throw error('CV_PDF_LINK','CV PDF is missing the correct clickable fit link.');
    for (const contact of content?.identity?.contacts || []) {
      const href=safeApplicationCvContactHref(contact.href);
      if (clean(contact.label) && href.startsWith('tel:') && !links.some(link => link.url === href || link.unsafeUrl === href)) {
        throw error('CV_PDF_CONTACT_LINK','CV PDF is missing the clickable phone number.');
      }
    }
    return {pageCount:1,textLength:text.length,fitLink:fitUrl};
  } finally {await loading.destroy();}
}

export async function renderApplicationCvPdf(content,options={}) {
  const html=await renderApplicationCvHtml(content,options);
  const {chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined});
  try {
    const page=await browser.newPage({viewport:{width:794,height:1123},deviceScaleFactor:1});
    await page.route('**/*',route => route.abort());
    await page.emulateMedia({media:'print'});
    await page.setContent(html,{waitUntil:'load'});
    const layout=await page.evaluate(async () => {
      await document.fonts.ready;
      const sheet=document.querySelector('#cv-page');
      const last=sheet.lastElementChild;
      const rect=sheet.getBoundingClientRect(),end=last.getBoundingClientRect();
      return {height:rect.height,contentBottom:end.bottom-rect.top,overflow:end.bottom-rect.top-rect.height,
        fontsReady:document.fonts.check('400 13px Plex') && document.fonts.check('600 13px Plex') && document.fonts.check('700 29px Schibsted'),
        bodyPixels:parseFloat(getComputedStyle(document.body).fontSize)};
    });
    if (!layout.fontsReady) throw error('CV_PDF_FONTS','Bundled CV fonts did not load.');
    if (layout.bodyPixels<Math.max(13,Number(options.minBodyPx)||13)) throw error('CV_PDF_FONT_SIZE','CV body text is below the required size.');
    if (layout.overflow>1 || layout.contentBottom>1122) throw error('CV_PDF_OVERFLOW',`CV exceeds one readable A4 page by ${Math.ceil(Math.max(layout.overflow,0))} pixels.`);
    const pdfBytes=await page.pdf({format:'A4',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false,tagged:true});
    await validateApplicationCvPdf(pdfBytes,{fitUrl:content.fitUrl,name:content.identity.name,content});
    return {pdfBytes,pdfSha256:createHash('sha256').update(pdfBytes).digest('hex'),layout};
  } finally {await browser.close();}
}
