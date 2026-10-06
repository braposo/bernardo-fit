// Read-only verification of the published application CV source and seed IDs.
import {loadApplicationCvSource} from '../lib/application-cv-source.js';
import {createContentClient} from '../lib/sanity/client.js';
const client=createContentClient();
const source=await loadApplicationCvSource(null,client);
const docs=await client.fetch('*[_type in ["applicationCvRole","applicationCvEducation","applicationCvProject","applicationCvEvidence"] && defined(seedKey)] | order(seedKey asc){_id,_type,seedKey}');
const allEvidence=[...source.roles,...source.education,...source.projects].flatMap(x=>x.evidence);
if(!source.roles.some(x=>x.company==='SingleStore'&&x.evidence.some(e=>e.status==='proposed')))
  throw Error('SingleStore proposed migration was not classified as proposed.');
if(!source.roles.some(x=>x.company.includes('TravelRepublic')&&x.evidence.some(e=>e.text.includes('GraphQL'))))
  throw Error('TravelRepublic GraphQL evidence missing.');
console.log(JSON.stringify({fingerprint:source.fingerprint,model:source.settings.model,roleCount:source.roles.length,
  projectCount:source.projects.length,educationCount:source.education.length,evidenceCount:allEvidence.length,
  records:docs.map(({_id,_type,seedKey})=>({id:_id,type:_type,seedKey}))},null,2));
