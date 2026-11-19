// Renders a local PDF preview of the hands-on lead CV content without writing to Sanity.
// Usage: node scripts/preview-hands-on-lead-cv.mjs <source.json> <output.pdf>
import {readFileSync,writeFileSync} from 'node:fs';
import {renderGeneralApplicationCv} from '../lib/application-cv-general.js';
import {renderApplicationCvPdf} from '../lib/application-cv-render.js';
import {GENERAL_CV_PUBLIC_URL} from '../lib/general-cv-availability.js';
import * as C from './hands-on-lead-content.mjs';
const s=JSON.parse(readFileSync(process.argv[2],'utf8'));
s.identity.headline=C.LEAD_CV_HEADLINE;
s.profile.paragraphs=C.LEAD_PROFILE_PARAGRAPHS; s.profile.skills=C.LEAD_SKILLS;
const ss=s.roles.find(r=>r.company==='SingleStore'); ss.title=C.LEAD_SINGLESTORE.title;
Object.assign(ss.detail,{scope:C.LEAD_SINGLESTORE.scope,responsibilities:C.LEAD_SINGLESTORE.responsibilities,stack:C.LEAD_SINGLESTORE.stack});
ss.evidence.find(e=>e.id==='application-cv-two-page-singlestore-docs-v2').text=C.LEAD_DOCS_V2;
const fit=s.projects.find(p=>p.title==='Fit'); fit.detail.scope=C.LEAD_FIT.scope;
fit.detail.highlights=fit.detail.highlights.map(h=>C.LEAD_FIT.highlightReplacements[h]||h);
const {rendered}=await renderGeneralApplicationCv(s,{publicUrl:GENERAL_CV_PUBLIC_URL,render:renderApplicationCvPdf});
writeFileSync(process.argv[3],Buffer.from(rendered.pdfBytes)); console.log(rendered.layout);
