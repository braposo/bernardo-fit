// Approved two-page CV content, agreed with the owner on 2026-10-07 in the
// "Two-page CV: draft role content" document. Seeding writes it to Sanity,
// which stays the source of truth; editors change it there afterwards.

export const TWO_PAGE_CV_SOURCE_KEY='two-page-cv:2026-10-07';

export const TWO_PAGE_PROFILE={
  paragraphs:[
    "I turn problems into products. Years across engineering, design, marketing, sales and running my own business let me spot the problems worth solving, often before anyone has named them, and shape them into features that improve customers' lives and open new revenue streams. When technical work has to happen anyway, I look for ways to make it better for every team it touches. As AI makes code cheaper to write, knowing what to build and how to build it well is where I add the most.",
    "I'm a generalist engineer and engineering manager with over 15 years on difficult engineering problems, a strong feel for UX, and a focus on making technology approachable for the people who use it. I lead by a line from The Inner Game of Tennis: performance equals potential minus interference. My job is to remove as much interference as I can so each person's potential shows, giving the team ownership, a clear vision and goals. I actively work on my leadership through workshops, retreats and facilitator training.",
  ],
  skills:[
    {label:'Product and business',items:['finding problems worth solving','turning ideas into products','monetising features and opening new revenue streams',
      'business sense from running a company','UX and UI design','design systems','building features independently without design input',
      'working across marketing, sales, product and design']},
    {label:'Leadership',items:['ownership-driven teams','clear vision and goals','hiring','coaching','performance and promotion cases','facilitation and conflict resolution']},
    {label:'Engineering',items:['TypeScript (years of production and open-source use)','JavaScript','React','Next.js','Node.js','GraphQL','frontend architecture','web performance']},
    {label:'AI',items:['AI assistants','MCP servers','LLM integration']},
    {label:'Data and infrastructure',items:['SingleStore (how it works and how to get the most from it)','AWS','Vercel','Docker','CI/CD']},
  ],
  contributionsIntro:'The common thread in my side projects and open source is the human side of technology: making tools more approachable for the people who use them.',
};

// Keyed by the existing role seed keys. Achievements become approved evidence
// records, in this order; tailored CVs choose two or three of them.
export const TWO_PAGE_ROLES={
  singlestore:{depth:'full',
    scope:'Hired and led the Web team at a real-time distributed SQL database company, owning singlestore.com, the documentation platform, CMS infrastructure and AI integrations. Fully remote, reporting to a Senior Director of Engineering.',
    responsibilities:[
      'Hired, coached and grew the team; ran performance reviews and wrote promotion cases through calibration',
      'Set direction across the website, docs and AI integrations, coordinating priorities with Product, Design, Docs and Marketing',
      'Built a team culture of ownership and responsibility, keeping people motivated with a clear vision and goals for the future',
      'Partnered with Marketing and Sales on lead generation and understanding visitors, balancing trackers, consent and experimentation against site performance and a unified experience',
      "Worked with Legal on GDPR requirements for how visitor and product data was processed, and owned the team's Segment setup: what was captured from the product and our other apps, and where that data flowed",
      'Stayed hands-on with code reviews, architecture guidance and specific features',
      'Owned cross-surface infrastructure: redirects, CloudFront and Lambda behaviour, analytics and consent, and web security issues',
    ],
    achievements:[
      {key:'docs-v2',contribution:'team',text:"Led Docs v2 from beta to general availability, a project I proposed when it wasn't on the roadmap. Nobody had flagged it, but Customer Success was losing time to users the old docs failed to help, and the legacy platform was a constant support burden for engineers. I framed it as a modernisation project that also improved the experience for customers and other teams. We moved publishing to CI/CD pipelines, built a new frontend with Algolia search, and extracted and transformed content from a hard-to-access specialist docs platform. We changed direction several times based on what developers using the docs needed, and shipped features our own engineers asked for"},
      {key:'sqrl',contribution:'strategy',text:'Owned engineering strategy and resourcing for SQRL, an AI assistant across the website, docs and cloud portal with over 3,000 sessions a month'},
      {key:'mcp',contribution:'team',text:"Led the team that delivered the MCP server's authentication and transport layer (auth proxy, streamable HTTP, rate limiting, security hardening), now in the Docker MCP catalog"},
      {key:'redesigns',contribution:'team',text:'Led several major singlestore.com redesigns, including the homepage and solutions pages'},
      {key:'tracking',contribution:'team',text:'Enabled full-journey tracking with Marketing and Sales, following a person from an email, webinar or workshop through the website and docs into the product, and ran continuous A/B testing to optimise the site, without hurting performance'},
      {key:'contentstack',contribution:'team',text:'Moved the website from Netlify to Contentstack'},
      {key:'hackathon',contribution:'personal',text:'Ran the company-wide AI hackathon in March 2026'},
      {key:'platform-vision',contribution:'strategy',text:'Authored the Website Platform 2026 Vision, a plan for the website in a world where AI is built in: AI-assisted content and page creation, messages tailored to each visitor whether a person or an agent, the site as the source of truth that agents and AI tools rely on for the product, and stronger visibility in AI search. It proposed moving from Gatsby to a Next.js and Sanity platform that unifies the website, docs and other public-facing experiences, and aligned Web, Marketing, Docs and Product behind it'},
    ],
    stack:['TypeScript','React','Gatsby','Contentstack','Algolia','AWS CloudFront and Lambda','Segment','Mixpanel','MCP'],
    domains:['developer marketing website','marketing analytics and A/B testing','documentation platform','headless CMS','AI assistants','developer tooling','data privacy (GDPR)','real-time distributed SQL (SingleStore)']},
  travelrepublic:{depth:'full',
    scope:"Led the project to build a completely new mobile experience for the Emirates Group's travel brands (TravelRepublic, Emirates Holidays and Dnata Travel), working closely with Product and with group leadership based in another country. The platform served many thousands of visitors a day and millions in bookings a month, so search speed and performance had a direct effect on revenue.",
    responsibilities:[
      'Led the mobile-first Next.js PWA that became the shared foundation for all three brands',
      'Worked with Product to design technical solutions that fitted a large legacy flight-booking system',
      'Built extensive automated end-to-end tests across the whole booking journey, from landing and search to choosing a hotel or flight and checking out, so that what shipped worked and performed as expected',
      'Implemented technical SEO across the brand sites',
      'Set architecture and code standards across the team',
    ],
    achievements:[
      {key:'graphql',contribution:'personal',text:'Architected the GraphQL layer, built in Node.js, that aggregated data from the different booking APIs for the Next.js mobile frontend'},
      {key:'design-system',contribution:'mixed',text:'Built a multi-brand design system with the design team, making development faster and less prone to bugs'},
      {key:'checkout',contribution:'mixed',text:'Owned performance and reliability of the search and checkout path, a revenue-critical flow with many steps and requests carrying millions of pounds in bookings, where faster loading and an easier booking experience directly reduced lost bookings'},
    ],
    stack:['TypeScript','Next.js','React','Node.js','GraphQL','PWA'],
    domains:['travel ecommerce','flight and hotel booking','checkout flows','legacy system integration','web performance','SEO','end-to-end testing','multi-brand design systems']},
  edited:{depth:'full',
    scope:'One of the first engineers at a retail analytics startup, which grew from about 25 to more than 200 people during my four years there. The product relied on millions of data points and needed high performance.',
    responsibilities:[
      'Built and owned the core data-visualisation product, keeping it fast across millions of data points',
      'Built the design system from scratch with the design team, shaping the visual language and component architecture',
      'Debugged and improved several areas of the product for a better UX, and built features independently without design input',
      'Took part in migrating several parts of the system to TypeScript',
      'Moved to the marketing team to own the public website end to end',
      'Helped set engineering standards as the company went from startup to scale-up',
    ],
    achievements:[
      {key:'data-visualisation',contribution:'personal',text:'Built the React data-visualisation product at the centre of the analytics platform, performant across millions of data points'},
      {key:'design-system',contribution:'mixed',text:'Created a design system from scratch, used across the product'},
      {key:'open-source',contribution:'personal',text:"Published open-source React components (react-text-loop, react-responsive-picture) under the company's npm org"},
    ],
    stack:['React','TypeScript','JavaScript','MobX','Redux'],
    domains:['retail analytics','data visualisation','high-performance frontends','design systems','marketing website']},
  'connect-coimbra':{depth:'short',title:{from:'Co-founder',to:'Co-founder and freelance web developer'},
    scope:'My first startup: co-founded and ran a coworking space in Coimbra, a physical business I owned end to end, while freelancing as a web developer for agencies and Portuguese companies. It was profitable, had 20+ members, and was sold in 2014.',
    responsibilities:[
      'Ran every side of a sustainable business: marketing, pricing plans, bringing members through the door, finances and day-to-day operations',
      'Built a local tech community through events and workshops, spotting gaps in the market and turning my skills into educational content',
      'Built websites and web experiences for agencies and clients alongside it (JavaScript, PHP, Ruby on Rails, WordPress), which led to my first UK role',
    ],achievements:[],stack:[],domains:[]},
  'critical-software':{depth:'earlier',
    scope:'Built the web interface for onAll, a wearable real-time sensor system for elderly care (JavaScript, Ruby on Rails, Java).',
    responsibilities:[],achievements:[],stack:[],domains:[]},
};

export const TWO_PAGE_FEATURED={seedKey:'project:fit',dates:'2026',
  scope:'Designed and built my own job-search product in an agentic way, directing and reviewing Claude Code and Codex. For each job it writes a fit page, a tailored CV, a cover letter, company research and an interview pack.',
  highlights:[
    'A model router (Jev) picks the right Anthropic or OpenAI model for each task, and scores every job against my profile across five fit dimensions',
    'Durable Trigger.dev workflows with retries, pauses and recovery when APIs fail, plus monitoring of run timing, token use and cost per provider',
    'Scheduled tasks that watch LinkedIn and other sources for new roles',
    'Sanity as the source of truth for content, prompts and settings, including context for an AI assistant inside the product',
    'My own profile and writing-voice skills, so generated documents use my real experience and sound like me',
    'A component library and design system built with Claude Code',
  ],
  stack:['TypeScript','React','Sanity','Vercel','Trigger.dev','Anthropic and OpenAI APIs'],
  domains:['agentic product development','AI workflows','LLM routing and evaluation','cost and reliability monitoring']};

// One line each in Other contributions, keyed by the project's seed key.
export const TWO_PAGE_CONTRIBUTIONS={
  'project:hermans':'Building Hermans Club, a men\'s personal development company run AI-first, directing specialised agents across the business.',
  'contributions:project:open-source:v5':'react-text-loop, react-responsive-picture, figma-graphql and nextjs-solana-starter-kit, mostly in TypeScript and GraphQL.',
  'contributions:project:speaking:v5':'React Advanced London, GraphQL Conf and Design Systems London (2019), and a workshop at Solana Breakpoint in Amsterdam (2023).',
};

export const TWO_PAGE_CV_PROMPT='Choose the strongest approved achievements for a two-page CV tailored to this job. Each role lists its approved achievements in editorial order. For every role, pick two or three achievement IDs from that role\'s own list and order them with the most relevant to the job description and fit analysis first. Use a third achievement only when it adds evidence for an important requirement. Keep a rounded picture of each role: when achievements are equally relevant, prefer the one listed earlier. Never write, merge or change text, and never move an achievement to another role. Return the roles and a private requirement map that names real gaps honestly.';
