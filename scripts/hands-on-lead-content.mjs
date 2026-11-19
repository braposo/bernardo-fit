// Hands-on engineering lead positioning, proposed 2026-11-18 ("CV rebalance: hands-on engineering lead").
// Draft for preview; not yet applied to Sanity.
export const LEAD_CV_HEADLINE='Engineering Lead | Hands-on across product, architecture and teams';
export const LEAD_PROFILE_PARAGRAPHS=[
  "I'm an **engineer who leads**. I still design and build products myself, and I use AI to extend what I can do: I **orchestrate different models and agents**, and build agents of my own, to take a product from idea to production. Fit, my AI job-search product, is the latest example, with durable workflows, a model router and its own design system.",
  "Over 15 years I've been a **principal engineer**, a **staff engineer** and an **engineering manager**. I've built B2B analytics, a booking platform for three travel brands, a modular company website, developer docs and an AI assistant with design, marketing, sales and product. That range lets me **turn a business problem into architecture** and explain the trade-offs to the people paying for it.",
  "As a manager I **hired and grew a team** at SingleStore. I gave engineers ownership of whole products, wrote the cases for their promotions and made sure their work was seen beyond the team, while staying in the code myself.",
];
export const LEAD_SKILLS=[
  {label:'Engineering and architecture',items:['TypeScript','React','Next.js','Node.js','GraphQL','frontend architecture','design systems','AWS','Vercel']},
  {label:'AI engineering',items:['orchestrating models and agents','building agents','LLM integration','MCP servers','durable AI workflows']},
  {label:'Product and business',items:['B2B and consumer products','websites and docs','SEO and experimentation','working with sales and marketing']},
  {label:'Design',items:['UX and UI design','design tooling']},
  {label:'Leadership',items:['hiring','coaching','career growth and promotions','ownership-driven teams','facilitation']},
];
export const LEAD_SINGLESTORE={
  title:'Staff Engineer and Engineering Manager',
  scope:'Joined as a **staff engineer on the product**, then moved to the Web team as its lead and later its engineering manager, at a real-time distributed SQL database company. The team owned singlestore.com, the documentation platform, CMS infrastructure and AI integrations, working closely with Marketing, Sales and Legal. Fully remote.',
  stack:['TypeScript','React','Gatsby','Contentstack','Algolia','Kubernetes','Terraform','GitHub Actions','AWS','Segment','MCP'],
  responsibilities:[
    '**Led the move from Netlify to Contentstack**: designed the content schema, rebuilt the templates as modular components and built the front end from design to code, so Marketing could build the pages they needed',
    '**Stayed in the code**: took part in most architecture decisions, worked on the APIs feeding the website and docs, reviewed code and took on fixes off the critical path so the team could stay focused',
    '**Worked with SRE and security** on Terraform, CI/CD pipelines and security reviews, and moved the website and docs to Kubernetes',
    '**Hired and grew the team**: set goals and career plans with each engineer, took on new projects that widened the team\'s responsibilities and visibility, and wrote the promotion cases that followed',
  ],
};
export const LEAD_DOCS_V2='Proposed and **led Docs v2** from beta to general availability: CI/CD publishing, a new frontend with Algolia search, and content moved off a hard-to-reach legacy platform';
export const LEAD_FIT={
  scope:'**Designed and built my own job-search product**, orchestrating different models and coding agents and building agents of my own. For each job it writes a fit page, a tailored CV, a cover letter, company research and an interview pack.',
  highlightReplacements:{'A component library and design system built with Claude Code':'Its own **component library and design system**'},
};

// Candidate profile (feeds analysis, fit pages, cover letters and answers).
export const LEAD_CANDIDATE_HEADLINE='Hands-on engineering lead: building products, architecting systems, growing teams';
export const LEAD_CANDIDATE_SUMMARY=[
  "Bernardo Raposo is a hands-on engineering lead. He still designs and builds products himself and uses AI to extend what he can do, orchestrating different models and agents and building agents of his own. At SingleStore he joined as a Staff Engineer on the product, led the Web team as its team lead and then its Engineering Manager. He was hands-on there: he led the Netlify to Contentstack migration (content schema, modular templates, front-end components), took part in most architecture decisions, worked on the APIs feeding the website and docs, worked with SRE and security on Terraform, CI/CD and security reviews, and helped move the website and docs to Kubernetes. Before that he was Principal Engineer at TravelRepublic in the Emirates Group, one of the first engineers at EDITED, and the founder of a profitable coworking business in Portugal. He brings engineering depth plus design, marketing, product and business experience.",
  "Positioning, confirmed on 19 November 2026 (supersedes the 29 October engineering-manager-for-AI framing): lead with the engineer who still builds and architects, with broad business knowledge, and treat management as a strong plus: hiring, setting goals and career plans, widening the team's responsibilities and visibility, and writing the promotion cases that followed. Do not name Claude Code or Codex in employer-facing writing; describe him as an engineer who orchestrates models and agents and builds agents to extend his capabilities. Fit and Hermans Club are his own products, never work done at an employer. Do not describe SingleStore as pre-IPO or by headcount. Do not describe him as someone who turns problems into products.",
];
export const LEAD_CAREER_DIRECTION="Hands-on engineering leadership is the first preference: Engineering Lead or Lead Engineer, Tech Lead Manager, Head of Engineering at a small or mid-size company, Staff or Principal Engineer with real influence, and Engineering Manager roles that keep technical involvement. A people-management role with no hands-on work is still in range but not the goal. Director, VP or CTO scope at a large organisation is a stretch.\n\nCurrent preference (confirmed 19 November 2026, supersedes earlier career-direction preferences): building products and architecting solutions while leading and growing engineers, with a sustainable, clearly bounded remit. Promotion, a larger title and increasing organisational responsibility are not priorities.";
// Exact sentence swaps in longer texts; each must match once.
export const LEAD_TEXT_SWAPS=[
  ['Preferred balance is roughly 60% management and 40% technical work, including architecture, reviews and decisions.','Preferred balance is roughly 50% building and architecture and 50% leading people, including architecture, reviews and decisions.'],
  ['Current preference (supersedes conflicting earlier working preferences): well-paid, sustainable engineering management with manageable accountability','Current preference (supersedes conflicting earlier working preferences): well-paid, sustainable hands-on engineering leadership with manageable accountability'],
  ['Engineering Manager is my preferred next role and strongest fit. I work between','Hands-on engineering leadership is my preferred next role: Lead, Tech Lead Manager, Head of Engineering, Staff or Principal Engineer, or an Engineering Manager role that keeps me building. I work between'],
  ['Engineering Manager is my preferred next role and strongest fit. I\'m also open to the right senior IC role or broader leadership in a smaller company, including CTO/technical co-founder work.','Hands-on engineering leadership is my preferred next role: Lead, Tech Lead Manager, Head of Engineering, Staff or Principal Engineer, or an Engineering Manager role that keeps me building. Broader leadership in a smaller company, including CTO/technical co-founder work, is also open.'],
  ['Engineering Manager is his first preference, with continuing technical involvement.','Hands-on engineering leadership is his first preference (Lead, Tech Lead Manager, Head of Engineering, Staff or Principal Engineer, or Engineering Manager with technical involvement).'],
];
// Scoring rubric (fit-analysis-settings questions): broaden from EM-only to hands-on leadership.
export const LEAD_RUBRIC_SWAPS={
  responsibilities:[
    ['Engineering management is the preferred route. Compare recurring duties with coaching, coordination, technical guidance and product/design collaboration, roughly 60% management and 40% technical involvement.','Hands-on engineering leadership is the preferred route: Engineering Lead, Tech Lead Manager, Head of Engineering at a small or mid-size company, Staff or Principal Engineer with real influence, or Engineering Manager with technical involvement. Compare recurring duties with building and architecture, technical direction, coaching and growing engineers, and product/design collaboration, roughly 50% building and architecture and 50% leading people.'],
    ['Supported recurring firefighting, excessive hands-on delivery alongside management or out-of-hours demands are trade-offs','Supported recurring firefighting, a role with no hands-on technical work or no influence on people and direction, or out-of-hours demands are trade-offs'],
  ],
  responsibilitiesCriteria:[
    'Dominant daily duties fundamentally conflict with the preferred sustainable hands-on engineering-leadership work',
    'Preferred building, architecture and leadership work is peripheral or explicit recurring demands make the daily work a poor match',
    null,
    'Most recurring technical and leadership duties align, with limited supported workload trade-offs',
    'Dominant duties closely match enjoyable, sustainable hands-on engineering leadership with concrete evidence of clear work boundaries',
  ],
  evidence:[['Prioritise a strong existing management track record and transferable achievements','Prioritise a strong existing engineering, architecture and leadership track record and transferable achievements']],
  scope:[['Prefer a contained engineering-management remit with clear accountability','Prefer a contained engineering-leadership remit (technical lead, team lead, staff or principal engineer, or engineering manager) with clear accountability']],
  scopeCriteria:[
    'The required accountability fundamentally conflicts with a manageable leadership remit',null,null,
    'Leadership ownership is contained and supported by the candidate record, with manageable accountability',
    'Concrete evidence supports a well-bounded leadership remit with clear authority and adequate support, without unnecessary organisational burden',
  ],
  direction:[
    ['The current goal is sustainable employment using existing engineering-management experience','The current goal is sustainable employment using existing engineering and engineering-leadership experience'],
    ['An otherwise suitable management role can score highly','An otherwise suitable engineering-leadership role can score highly'],
    ['Do not assume senior IC or CTO roles are equally preferred: management is the chosen employment route.','Hands-on engineering leadership is the chosen route: Lead, Tech Lead Manager, Head of Engineering at a small or mid-size company, Staff or Principal Engineer with real influence, and Engineering Manager roles with technical involvement are all preferred. Large-company Director, VP or CTO scope is a stretch.'],
  ],
  directionCriteria:[
    null,
    'The role has substantial supported conflicts with this life phase or the preferred hands-on leadership route',
    null,
    'The role clearly supports sustainable engineering-leadership employment and the current life phase without requiring corporate progression',
    'The role strongly supports the preferred hands-on leadership route and future independence; promotion or new CV credentials are not required',
  ],
};
