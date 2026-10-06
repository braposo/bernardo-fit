import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {safeApplicationCvContactHref} from './application-cv-contacts.js';
import {publicApplicationCvLinks} from './application-cv-links.js';

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
  const faces=[['Plex','IBMPlexSans-Regular.ttf',400],['Plex','IBMPlexSans-SemiBold.ttf',600],
    ['Schibsted','SchibstedGrotesk-SemiBold.ttf',600],['Schibsted','SchibstedGrotesk-Bold.ttf',700],['PlexMono','IBMPlexMono-Medium.ttf',500]];
  const fonts=await Promise.all(faces.map(async ([,name]) => (await readFile(fontUrl(name))).toString('base64')));
  return faces.map(([family,,weight],index) => `@font-face{font-family:${family};src:url(data:font/ttf;base64,${fonts[index]}) format('truetype');font-weight:${weight}}`).join('\n  ');
}

function entryMarkup(entry, className='entry') {
  const place=[entry.company ? entry.location : '',entry.dates].map(clean).filter(Boolean).join(' · ');
  return `<article class="${className}"><div class="entry-head"><span class="entry-title"><strong>${escape(entry.title)}</strong>${entry.company || entry.location ? ` <span class="entry-org">· ${escape(entry.company || entry.location)}</span>` : ''}</span>
    ${place ? `<span class="entry-when">${escape(place)}</span>` : ''}</div>
    ${(entry.bullets || []).map(bullet => `<p class="entry-detail">${escape(bullet.text)}</p>`).join('')}
    ${publicApplicationCvLinks(entry.links).length ? `<div class="entry-links">${publicApplicationCvLinks(entry.links).map(link=>`<a href="${escape(link.href)}">${escape(link.label)}</a>`).join('')}</div>` : ''}</article>`;
}

export async function renderApplicationCvHtml(content,{minBodyPx=13,showDownload=false}={}) {
  const general=content?.variant==='general';
  const fitUrl=safeHref(general ? content.publicUrl : content?.fitUrl);
  if (!fitUrl || !/^https?:/.test(fitUrl)) throw error('CV_FIT_URL','A public fit-page URL is required.');
  const bodyPx=Math.max(13,Number(minBodyPx)||13);
  if (!Number.isFinite(bodyPx) || bodyPx>18) throw error('CV_FONT_SIZE','The CV body size is invalid.');
  const contacts=(content.identity?.contacts || []).filter(c => clean(c?.label) && safeApplicationCvContactHref(c?.href))
    .map(c => `<a href="${escape(safeApplicationCvContactHref(c.href))}">${escape(c.label)}</a>`).join('');
  const section=(title,items) => items?.length ? `<section><h2>${escape(title)}</h2>${items.map(item => entryMarkup(item)).join('')}</section>` : '';
  const fontCss=await embeddedFonts();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escape(content.identity?.name)} · CV</title><style>${fontCss}
  @page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#211f1a}
  body{font-family:Plex,Arial,sans-serif;font-size:${bodyPx}px;line-height:1.36;font-variant-ligatures:none}
  .page{--accent:#1f6fb2;--paper:#faf8f4;--line:#e6e1d6;--sub:#5a564d;--body:#3b3831;width:210mm;min-height:296mm;padding:9mm 9mm 6mm;background:var(--paper);display:flex;flex-direction:column}
  header{padding:0 4.5mm}
  h1{font:700 34px/1 Schibsted,Plex,sans-serif;letter-spacing:-.035em;margin:0}h1 .dot{color:var(--accent)}
  .headline{font:600 14.5px/1.3 Schibsted,Plex,sans-serif;letter-spacing:-.01em;margin:6px 0 0}
  .contacts{display:flex;flex-wrap:wrap;gap:2px 14px;margin:8px 0 0;color:var(--sub);font-size:11px}
  a{color:inherit;text-decoration:none;border-bottom:1px solid var(--accent)}
  .intro{margin:8px 0 0;max-width:180mm;color:var(--body)}
  section{margin-top:3mm;background:#fff;border:1px solid var(--line);border-radius:10px;padding:3.5mm 4.5mm 4mm}
  h2{font:500 9.5px/1.3 PlexMono,monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin:0 0 7px}
  .entry{margin:0 0 10px;break-inside:avoid}.entry:last-child{margin-bottom:0}.entry-head{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
  .entry-title{font:600 14px/1.3 Schibsted,Plex,sans-serif;letter-spacing:-.01em}.entry-title strong{font-weight:600}.entry-org{color:var(--accent)}
  .entry-when{font:500 9.5px/1.3 PlexMono,monospace;letter-spacing:.02em;white-space:nowrap;color:var(--sub);text-transform:uppercase}
  .entry-detail{margin:3px 0 0;padding-left:8px;border-left:2px solid #e4ded1;break-inside:avoid;color:var(--body)}.entry-head+.entry-detail{margin-top:4px}
  .entry-links{display:flex;flex-wrap:wrap;gap:3px 12px;margin-top:4px;padding-left:10px;font-size:11px}
  footer{margin-top:auto;padding:3.5mm 4.5mm 0;font:500 9.5px/1.4 PlexMono,monospace;letter-spacing:.02em;color:var(--sub)}
  footer a{color:var(--accent);border-bottom-color:currentColor}
  .download{display:none}
  @media screen{body{background:#e6e1d6;padding:24px 20px}.page{margin:auto;border-radius:4px;overflow:hidden;box-shadow:0 1px 2px #211f1a14,0 18px 40px -20px #211f1a40}
    .download{display:flex;justify-content:flex-end;max-width:210mm;margin:0 auto 16px}.download a{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:10px 18px;background:#211f1a;color:#fff;border:0;border-radius:999px;font-weight:600}
    .download a:hover{background:#1f6fb2}
    @media(max-width:834px){body{padding:16px;font-size:16px}.page{width:100%;min-height:0;padding:26px 12px 22px}header{padding:0 8px 6px}section{margin-top:14px;padding:18px 16px;border-radius:12px}footer{padding:22px 8px 0;font-size:12px}h1{font-size:32px}.headline{font-size:17px}.entry-head{flex-direction:column;gap:3px}.entry-title{font-size:17px}.entry-when{white-space:normal;font-size:12px}.contacts{font-size:13px}.contacts,.entry-links{gap:8px 12px}.entry-links{font-size:13px}.entry{margin-bottom:18px}a{overflow-wrap:anywhere}}}
  </style></head><body>${general && showDownload ? '<nav class="download" aria-label="CV download"><a href="/bernardo-raposo-cv.pdf">Download CV · PDF</a></nav>' : ''}<main class="page" id="cv-page"><header><h1>${escape(content.identity?.name)}<span class="dot" aria-hidden="true">.</span></h1>
  <p class="headline">${escape(content.identity?.headline)}</p><div class="contacts">${contacts}</div>
  ${content.summary && content.summary !== content.identity?.headline ? `<p class="intro">${escape(content.summary)}</p>` : ''}</header>
  ${section('Experience',content.experience)}${section('Education',content.education)}${section('Other contributions',content.projects)}
  <footer>${general ? 'More about my work' : 'Role fit and supporting analysis'}: <a id="fit-link" href="${escape(fitUrl)}">${escape(fitUrl.replace(/^https?:\/\//,''))}</a></footer>
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
          .flatMap(entry => [entry.title, entry.company || entry.location, ...(entry.bullets || []).map(b => b.text), ...publicApplicationCvLinks(entry.links).map(link=>link.label)])]
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
    for (const link of (content?.projects || []).flatMap(entry=>publicApplicationCvLinks(entry.links))) {
      if(!links.some(annotation=>annotation.url===link.href))throw error('CV_PDF_CONTRIBUTION_LINK','CV PDF is missing a contribution link.');
    }
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
      // FontFaceSet.ready only loads faces used by the current layout. The
      // redesigned headings no longer use Plex 600, but we validate every face.
      await Promise.all([...document.fonts].map(face => face.load()));
      await document.fonts.ready;
      const sheet=document.querySelector('#cv-page');
      const last=sheet.lastElementChild;
      const rect=sheet.getBoundingClientRect(),end=last.getBoundingClientRect();
      return {height:rect.height,contentBottom:end.bottom-rect.top,overflow:end.bottom-rect.top-rect.height,
        fontsReady:document.fonts.check('400 13px Plex') && document.fonts.check('600 13px Plex') && document.fonts.check('700 29px Schibsted') && document.fonts.check('600 14px Schibsted') && document.fonts.check('500 10px PlexMono'),
        bodyPixels:parseFloat(getComputedStyle(document.body).fontSize)};
    });
    if (!layout.fontsReady) throw error('CV_PDF_FONTS','Bundled CV fonts did not load.');
    if (layout.bodyPixels<Math.max(13,Number(options.minBodyPx)||13)) throw error('CV_PDF_FONT_SIZE','CV body text is below the required size.');
    if (layout.overflow>1 || layout.contentBottom>1122) throw error('CV_PDF_OVERFLOW',`CV exceeds one readable A4 page by ${Math.ceil(Math.max(layout.overflow,0))} pixels.`);
    const pdfBytes=await page.pdf({format:'A4',preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false,tagged:true});
    await validateApplicationCvPdf(pdfBytes,{fitUrl:content.variant==='general'?content.publicUrl:content.fitUrl,name:content.identity.name,content});
    return {pdfBytes,pdfSha256:createHash('sha256').update(pdfBytes).digest('hex'),layout};
  } finally {await browser.close();}
}
