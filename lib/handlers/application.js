import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {getPublicApplicationCv,applicationCvFilename} from '../application-cv-store.js';
import {escapeHtml,safeUrl} from '../sanity/public-pages.js';

const esc=escapeHtml;
const row=(title,body)=>`<div class="row"><h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;
const renderReport=report=>report?`<article class="report" aria-labelledby="role-title"><div class="kicker">Where I'd fit</div><h1 id="role-title">${esc(report.job_title)}${report.company?` <span>at ${esc(report.company)}</span>`:''}</h1>${report.pitch?`<p class="pitch">${esc(report.pitch)}</p>`:''}
  ${report.categories?.length?`<h2 class="section-label">The fit</h2><div class="rows">${report.categories.map(c=>row(c.name,c.note)).join('')}</div>`:''}
  ${report.differentiators?.length?`<h2 class="section-label">What I bring</h2><div class="rows">${report.differentiators.map(d=>row(d.headline,d.detail)).join('')}</div>`:''}
  </article>`:'';
const contacts=items=>(items||[]).filter(c=>safeUrl(c.href)).map(c=>`<a href="${esc(c.href)}" rel="noopener">${esc(c.label)}</a>`).join('');
const cvRole=role=>`<section class="role"><div class="role-head"><h3>${esc([role.title,role.company].filter(Boolean).join(' · '))}</h3><span class="dates">${esc(role.dates)}</span></div>${role.location?`<div class="place">${esc(role.location)}</div>`:''}<ul>${(role.bullets||[]).map(b=>`<li>${esc(typeof b==='string'?b:b.text)}</li>`).join('')}</ul></section>`;
export function renderPublicApplication(data,template){
  const cv=data.version.content||{},identity=cv.identity||{},download=`/fit/${encodeURIComponent(data.publicId)}/cv.pdf`;
  const html=template.replace('<!-- TITLE -->',esc(`${data.report?.job_title||'Application'} · ${identity.name||'Bernardo Raposo'}`))
    .replace('<!-- REPORT -->',renderReport(data.report))
    .replace('<!-- CV -->',`<article class="cv" aria-labelledby="cv-heading"><div class="cv-title"><div><div class="section-label">Application CV</div><h2 id="cv-heading">${esc(identity.name||'Bernardo Raposo')}</h2><p class="headline">${esc(identity.headline)}</p></div><a class="download" href="${download}">Download CV · PDF</a></div><div class="contacts">${contacts(identity.contacts)}</div>${cv.summary && cv.summary !== identity.headline?`<p class="cv-summary">${esc(cv.summary)}</p>`:''}<div class="experience"><h3 class="section-label">Experience</h3>${(cv.experience||[]).map(cvRole).join('')}${(cv.education||[]).length?`<h3 class="section-label">Education</h3>${cv.education.map(cvRole).join('')}`:''}${(cv.projects||[]).length?`<h3 class="section-label">Projects &amp; speaking</h3>${cv.projects.map(cvRole).join('')}`:''}</div></article>`);
  return html;
}
export function createApplicationHandler(getPublic=getPublicApplicationCv,readTemplate=()=>readFile(new URL('../templates/application.html',import.meta.url),'utf8'),fetchPdf=fetch){
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Robots-Tag','noindex, nofollow');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return res.status(405).end();}
    const publicId=req.query?.publicId,kind=req.query?.kind;
    if(typeof publicId!=='string')return res.status(404).end();
    try{
      const data=await getPublic(publicId);if(!data)return res.status(404).end();
      if(kind==='pdf'){
        const url=new URL(data.pdfUrl);
        if(url.origin!=='https://cdn.sanity.io' || !url.pathname.startsWith('/files/quli96gc/production/') || !url.pathname.endsWith('.pdf'))return res.status(404).end();
        const response=await fetchPdf(url.href);if(!response.ok)return res.status(503).end();
        const bytes=Buffer.from(await response.arrayBuffer());
        if(bytes.length>5_000_000 || createHash('sha256').update(bytes).digest('hex')!==data.version.pdfSha256)return res.status(503).end();
        const filename=applicationCvFilename({content:data.version.content,reportSnapshot:{report:data.report}});
        res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
        return res.status(200).send(req.method==='HEAD'?'':bytes);
      }
      if(kind==='json')return res.status(200).json({report:data.report,cv:data.version,downloadUrl:`/fit/${encodeURIComponent(data.publicId)}/cv.pdf`});
      if(kind)return res.status(404).end();
      const html=renderPublicApplication(data,await readTemplate());
      res.setHeader('Content-Type','text/html; charset=utf-8');
      return res.status(200).send(req.method==='HEAD'?'':html);
    }catch{return res.status(503).send('This page is temporarily unavailable. Please try again shortly.');}
  };
}
export default createApplicationHandler();
