import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {getPublicApplicationCv,applicationCvFilename} from '../application-cv-store.js';
import {escapeHtml,scriptJson} from '../sanity/public-pages.js';
import {safeApplicationCvContactHref} from '../application-cv-contacts.js';
import {publicApplicationCvLinks} from '../application-cv-links.js';
import {applicationCvLocationLines} from '../application-cv-location.js';

const esc=escapeHtml;
const row=(title,body)=>`<div class="row"><h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;
const renderReport=report=>report?`<article class="report" aria-labelledby="role-title"><h1 id="role-title">${esc(report.job_title)}${report.company?` <span>at ${esc(report.company)}</span>`:''}</h1>${report.pitch?`<p class="pitch">${esc(report.pitch)}</p>`:''}
  ${report.categories?.length?`<h2 class="section-label">The fit</h2><div class="rows">${report.categories.map(c=>row(c.name,c.note)).join('')}</div>`:''}
  ${report.differentiators?.length?`<h2 class="section-label">What I bring</h2><div class="rows bring">${report.differentiators.map(d=>row(d.headline,d.detail)).join('')}</div>`:''}
  </article>`:'';
const contacts=items=>(items||[]).filter(c=>safeApplicationCvContactHref(c.href))
  .map(c=>`<a href="${esc(safeApplicationCvContactHref(c.href))}" rel="noopener">${esc(c.label)}</a>`).join('');
const links=item=>publicApplicationCvLinks(item.links).length?`<div class="entry-links">${publicApplicationCvLinks(item.links).map(link=>`<a href="${esc(link.href)}" rel="noopener">${esc(link.label)}</a>`).join('')}</div>`:'';
// Two-page copy marks key skills with **double asterisks**; they render bold.
const rich=value=>esc(value).replace(/\*\*(.+?)\*\*/g,'<strong class="em">$1</strong>');
const paragraphs=(items,className='entry-detail')=>(items||[]).map(text=>`<p class="${className}">${rich(typeof text==='string'?text:text.text)}</p>`).join('');
const facts=(label,items)=>items?.length?`<p class="entry-facts"><span class="facts-label">${label}</span> ${items.map(esc).join(' · ')}</p>`:'';
// Two-page CVs keep the fit page short: each role shows its scope and the
// achievements chosen for this job, with the fixed stack and responsibilities
// folded behind a native Full role toggle (the PDF carries everything). The
// featured project shows its scope, stack and highlights. One-page roles keep
// their evidence paragraphs.
const items=list=>list?.length?`<div class="entry-details">${list}</div>`:'';
const fullRole=role=>role.stack?.length||role.responsibilities?.length
  ?`<details class="role-more"><summary>Full role</summary>${facts('Stack',role.stack)}${items(paragraphs(role.responsibilities))}</details>`:'';
const roleDetails=role=>role.highlights
  ?`${role.scope?`<p class="entry-scope">${rich(role.scope)}</p>`:''}${facts('Stack',role.stack)}${items(paragraphs(role.highlights,'entry-detail entry-highlight'))}`
  :role.depth
  ?`${role.scope?`<p class="entry-scope">${rich(role.scope)}</p>`:''}${items(paragraphs(role.bullets,'entry-detail entry-highlight'))}${fullRole(role)}`
  :(role.bullets||[]).length?`<div class="entry-details">${paragraphs(role.bullets)}</div>`:'';
const cvRole=role=>`<section class="role"><div class="role-meta">${role.dates?`<span class="dates">${esc(role.dates)}</span>`:''}${applicationCvLocationLines(role.location).map(place=>`<span class="place">${esc(place)}</span>`).join('')}</div><div class="role-body"><h3>${esc(role.title)}${role.company?` <span class="company">· ${esc(role.company)}</span>`:''}</h3>${roleDetails(role)}${links(role)}</div></section>`;
const contribution=item=>`<p class="contribution"><strong>${esc(item.title)}</strong> ${(item.bullets||[]).map(b=>esc(typeof b==='string'?b:b.text)).join(' ')}${publicApplicationCvLinks(item.links).map(link=>` <a href="${esc(link.href)}" rel="noopener">${esc(link.label)}</a>`).join('')}</p>`;
const label=text=>`<h3 class="section-label">${text}</h3>`;
const classicSections=cv=>`${label('Experience')}${(cv.experience||[]).map(cvRole).join('')}${(cv.education||[]).length?`${label('Education')}${cv.education.map(cvRole).join('')}`:''}${(cv.projects||[]).length?`${label('Other contributions')}${cv.projects.map(cvRole).join('')}`:''}`;
const detailedSections=cv=>`${(cv.profile?.skills||[]).length?`${label('Core skills')}<div class="skills">${cv.profile.skills.map(group=>`<p class="skill"><strong>${esc(group.label)}</strong> ${(group.items||[]).map(rich).join(', ')}</p>`).join('')}</div>`:''}
  ${label('Experience')}<div class="jobs">${(cv.experience||[]).map(cvRole).join('')}${(cv.earlier||[]).map(role=>cvRole({...role,bullets:[{text:role.text}]})).join('')}</div>
  ${(cv.featured||[]).length?`${label('Featured project')}${cv.featured.map(cvRole).join('')}`:''}
  ${(cv.projects||[]).length?`${label('Side projects and community')}${cv.contributionsIntro?`<p class="section-intro">${esc(cv.contributionsIntro)}</p>`:''}<div class="contributions">${cv.projects.map(contribution).join('')}</div>`:''}
  ${(cv.education||[]).length?`${label('Education')}${cv.education.map(item=>cvRole({...item,bullets:[]})).join('')}`:''}`;
const profile=cv=>cv.layout==='detailed'?(cv.profile?.paragraphs||[]).map(text=>`<p class="cv-summary">${rich(text)}</p>`).join('')
  :cv.summary && cv.summary !== cv.identity?.headline?`<p class="cv-summary">${esc(cv.summary)}</p>`:'';
// A shared report (/?r=) uses the same page with the published general CV:
// the CV is never labelled as tailored and views keep their tracking.
export function renderPublicApplication(data,template,{shared=false}={}){
  const cv=data.version.content||{},identity=cv.identity||{};
  const download=shared?'/bernardo-raposo-cv.pdf':`/fit/${encodeURIComponent(data.publicId)}/cv.pdf`;
  const track=shared&&data.reportId?`<script>(function(){var id=${scriptJson(data.reportId)};function t(e){try{fetch("/api/track",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id,event:e}),keepalive:true}).catch(function(){})}catch(_){}}t("view");var d=document.querySelector("a.download");if(d)d.addEventListener("click",function(){t("cv_download")});})();</script>`:'';
  const html=template.replace('<!-- TITLE -->',()=>esc(`${data.report?.job_title||'Application'} · ${identity.name||'Bernardo Raposo'}`))
    .replace('A fit report and application CV',shared?'A fit report and CV':'A fit report and application CV')
    .replace('<!-- REPORT -->',()=>renderReport(data.report))
    .replace('<!-- CV -->',()=>`<article class="cv" aria-labelledby="cv-heading"><div class="cv-title"><div><div class="section-label">${shared?'CV':'Application CV'}</div><h2 id="cv-heading">${esc(identity.name||'Bernardo Raposo')}<span class="dot" aria-hidden="true">.</span></h2><p class="headline">${esc(identity.headline)}</p></div><a class="download" href="${download}">Download CV · PDF</a></div><div class="contacts">${contacts(identity.contacts)}</div>${profile(cv)}<div class="experience${cv.layout==='detailed'?' detailed':''}">${cv.layout==='detailed'?detailedSections(cv):classicSections(cv)}</div></article>${track}`);
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
