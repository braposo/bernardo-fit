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
