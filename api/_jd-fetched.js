// Job descriptions pulled from the public LinkedIn guest view of each posting,
// keyed by the externalId used in _inbox-scan.js.
//
// Fetched once, by hand, on 17 Aug 2026 and captured here. The server does not
// scrape LinkedIn at runtime: a Vercel function hitting LinkedIn on a schedule
// would be blocked quickly and would breach their terms. Refreshing means
// re-fetching and replacing this file.
//
// Text is the readable extract of each posting, not raw HTML. That is what
// gets fed to the analyser, so boilerplate and navigation are already gone.
//
// Not present here:
//   cuvva--engineering-manager           posting expired, redirects to search
//   premier-farnell--ui-engineering-...  came by InMail, never had a URL
//   the five Off-target rows             deliberately skipped, marked not_a_fit

export const FETCHED_JDS = {
  "sanity--software-engineering-manager-web": `Software Engineering Manager, Web at Sanity. London Area or San Francisco Bay Area. Mid-senior, full-time.

Sanity is hiring a Software Engineering Manager for the Web team.

Responsibilities:
- Lead and develop the web team: manage and mentor a team of 2+ engineers.
- Own the web roadmap and shift the team from reactive support to proactive innovation.
- Drive AI-native web experiences, leveraging Sanity's platform and emerging AI tools.
- Partner cross-functionally with marketing, design and product.
- Own web performance and metrics, accountable for KPIs such as conversion rates.

Requirements:
- 8+ years web engineering experience with 1-3+ years in leadership roles.
- Strong technical background in modern web development.
- Experience owning or contributing to high-impact marketing or product websites.
- Product mindset with cross-functional collaboration skills.
- Familiarity with experimentation, analytics and growth optimisation.

Compensation: San Francisco range $230K-$260K. London aligned to local market rates.

About Sanity: AI-powered content operations platform used by SKIMS, Figma, Riot Games and Anthropic. Recently raised an $85M Series C.`,

  "openai--manager-forward-deployed-engineering": `Manager, Forward Deployed Engineering at OpenAI. London, hybrid, 3 days in office per week. Relocation assistance offered. Travel up to 25%.

OpenAI's Forward Deployed Engineering team partners with customers to convert research breakthroughs into production systems, operating at the intersection of customer delivery and core platform development.

As an FDE manager you will lead FDEs through high-stakes, ambiguous customer deployments and own technical and business value outcomes end to end. You will grow a team that can operate under pressure and help OpenAI learn from the field. You will partner closely with Product, Research, Sales and GTM so fieldwork informs roadmap priorities and supports safe deployment at scale.

Responsibilities:
- Lead and grow a team of FDEs delivering production systems with frontier models.
- Own end-to-end delivery outcomes through clarity, speed, coordination and technical quality.
- Codify effective practices into tools, playbooks and roadmap inputs.
- Identify and raise early indicators about product behaviour and delivery practices.
- Set high performance standards and give direct, actionable feedback.
- Define staffing and support models for scalable field teams.

Requirements:
- 8+ years engineering or technical delivery experience, 2+ years managing FDE or customer-facing engineers.
- Led high-pressure technical projects from prototype to production.
- Production-grade code writing and review in JavaScript or Python.
- Ability to simplify complexity and decide under pressure.
- Translates field experience into actionable feedback for Product and Research.`,

  "lightdash--head-of-engineering": `Head of Engineering at Lightdash. London Area, United Kingdom. Director level, full-time. Artificial Intelligence and Software Development.

Lightdash seeks a deeply technical Head of Engineering to partner with the CTO and lead the engineering organisation's next phase. The ideal candidate is a seasoned builder who thrives in high-velocity, high-ownership startup environments and believes momentum beats perfection.

Responsibilities:
- Set the bar for engineering velocity through coaching, mentoring and unblocking the team.
- Make architectural and security decisions quickly while maintaining long-term resilience.
- Build and own best-in-class developer experience through tooling and workflows.
- Monitor and protect reliability and SLAs while maintaining startup speed.
- Establish a culture celebrating iteration over perfectionism.

Qualifications: one of a seasoned engineer with prior Head of Engineering or EM experience at a venture-backed startup; an ex-founder who shipped under pressure; or a startup tech lead who thrives on ownership. Engineering leadership in high-velocity environments, deep technical expertise with strong architecture and security instincts, startup operator mindset, AI-first orientation with daily engagement, developer-experience focus, and execution focus on monitoring and observability.

Stack: TypeScript, React, Node, SQL; Express, React hooks, Redux, RTK, Mantine; Docker, GCP, Kubernetes, tracing, Prometheus.

Culture: build in public, open source means moving fast with shared context, challenge problems rather than people, bias toward impact over perfection.`,

  "ashby--engineering-manager-uk": `Engineering Manager, UK at Ashby. London, England. Salary £110,000 - £200,000 per year.

Colin, Director of Engineering Europe, seeks an engineering manager to build a distinctive engineering culture where developers write product specs, make decisions and own projects without rigid ticketing processes. The position emphasises trusting engineers with autonomy while maintaining high standards through coaching and feedback.

Responsibilities:
- Focus on individual performance, team development and culture rather than sprint planning.
- Mentor engineers to handle large, loosely-defined projects with minimal intervention.
- Provide feedback on product and technical specifications to influence IC decisions.
- Contribute hands-on code to debug issues, ship fixes and improve developer experience.
- Manage approximately 6 direct reports for junior EMs.

Requirements:
- Passion for both technical work and management challenges.
- Ability to hold in-depth technical conversations across infrastructure, backend and frontend.
- Strong communication and empathy for organisational change.
- Deep understanding of what makes exceptional engineers tick.
- Comfort with high-trust, high-autonomy startup environments.
- Interest in product and business thinking without controlling final decisions.
- Genuine enjoyment of coding and staying current with technology.

Ashby is talent management software that automates recruitment coordination and scheduling for hiring teams.`,

  "getty-images--head-of-web-unsplash": `Head of Web, Unsplash at Getty Images. London, England. Full-time.

Lead a small engineering team building and enhancing features for unsplash.com, a visual search engine powering over 10,000 applications. This is a player-coach role combining hands-on technical contribution with leadership responsibility for team growth and product delivery.

Responsibilities:
- Lead engineers building features for unsplash.com.
- Collaborate cross-functionally with Web, API, Design and Data teams to understand product priorities.
- Develop and deliver product ideas aligned with business needs.
- Promote ownership, accountability and high standards within the team.
- Maintain and optimise the front-end platform for performance and developer experience.
- Support team member growth and career development.
- Drive decisions using data-driven insights.

Requirements:
- Player-coach readiness with hands-on technical contribution.
- Team leadership experience with accountability for member growth and performance.
- Expert-level proficiency in Node, TypeScript, React and Next.js.
- Experience building web applications at scale.
- Functional programming experience.

Nice to have: search, SEO or ecommerce feature development experience.`,

  "parloa--manager-forward-deployed-engineering": `Manager, Forward Deployed Engineering at Parloa. London, England. Full-time, mid-senior.

Lead a team of Forward Deployed Engineers managing strategic enterprise AI deployments. Ensure consistent delivery excellence, engineering quality and rapid issue resolution in complex enterprise environments while maintaining technical credibility.

Responsibilities:
- Lead and develop the FDE team through hiring, coaching, performance feedback and career growth.
- Allocate engineers across parallel strategic projects; manage capacity and utilisation.
- Own engineering delivery across deployments: milestones, dependencies, risk management, escalation.
- Implement lightweight tracking and reporting for effort, progress and capacity.
- Provide technical leadership: guide architecture choices, review designs, unblock production issues.
- Build reusable field engineering patterns, playbooks and standards.
- Translate recurring customer needs into productisation proposals for Product and Core Engineering.
- Partner with customer engineering and enterprise stakeholders to build technical trust.

Requirements:
- 8+ years software engineering, systems integration, DevOps or data engineering with production responsibility.
- Proven people leadership: formal management, team lead roles, hiring, performance development.
- Success delivering complex technical projects in large enterprise environments.
- Technical breadth: backend engineering, APIs, cloud platforms, Kubernetes, infrastructure-as-code, databases.
- Strong planning, prioritisation, capacity thinking and risk management.
- Plus: experience building or integrating AI and LLM-powered systems in forward-deployed environments.

Stack: TypeScript, NodeJS, OpenAI, Microsoft Azure, Kubernetes, Docker, Terraform, MongoDB, MySQL, Redis, Kafka, MCP.`,

  "multiverse--senior-engineering-manager": `Senior Engineering Manager at Multiverse. London, England. Full-time, mid-senior.

Lead the Diagnose and Prescribe service estate, which determines learner and employer skill needs then directs them to appropriate apprenticeships. The role bridges product development and technical leadership, requiring hands-on involvement alongside team management.

Responsibilities:
- Own delivery, technical direction and team health across Diagnose and Prescribe services.
- Lead diagnosis and needs assessment using AI, including RAG and LLM-scored evaluation.
- Build prescription and eligibility products with financial and regulatory implications.
- Manage recommendation and onboarding systems translating diagnoses into learning paths.
- Oversee platform modernisation from legacy monolith to dedicated services.
- Hire, mentor and develop high-performing teams in AI-native practices.
- Write production code and review distributed system designs.
- Balance shipping speed against technical debt using cycle time and change failure metrics.
- Partner with Product and Design on strategy informed by learner behaviour.

Requirements:
- Engineering management of full-stack production teams with deep technical credibility.
- Shipped AI features to real users and operated them in production.
- Strong Python and TypeScript, React and Next.js including App Router and RSC, tRPC or GraphQL, Node and Express.
- PostgreSQL at scale via ORM with migration discipline.
- Event-driven systems experience: RabbitMQ, versioned events, idempotency.
- High maturity bar: typing, testing, feature flags, ADRs, CI/CD, observability.
- Daily AI-native development using Claude, Cursor or equivalent tools.`,

  "hubscale--head-of-forward-deployed-engineering": `Head of Forward Deployed Engineering at Hubscale. London Area, with travel to the Gulf region. Director level, full-time. NOTE: the posting states it is no longer accepting applications.

First Head of Forward Deployed Engineering at an AI infrastructure startup. A player-coach position owning the entire customer deployment motion, from discovery through go-live. You will establish the deployment playbook that future FDE hires follow.

Responsibilities:
- Own end-to-end customer deployments for critical infrastructure: ports, airlines, energy grids.
- Stay hands-on: write production-grade code and ship full-stack features alongside customers.
- Determine which one-off solutions become platform features.
- Build and mentor an FDE team while maintaining individual contribution.
- Define technical specifications that guide engineering priorities.
- Measure success by operational dependency, not ticket volume.

Requirements:
- 5+ years in forward-deployed, field or customer-facing engineering roles shipping production code.
- Personally led enterprise or government deployments to live production.
- Strong TypeScript and React; Python or Node expertise.
- Excellent communication with technical and non-technical stakeholders.
- Coach junior engineers while staying hands-on.
- Comfortable operating without detailed specifications or established processes.

Nice to have: AI-native product experience; enterprise security background including SSO, VPCs, compliance reviews, on-premises systems; operationally complex industry experience in logistics, aviation, energy or industrial.

Compensation: competitive base plus early-stage equity. Travel a few days monthly or bi-monthly to customer sites in the Gulf region.`,

  "kira--engineering-manager-united-kingdom": `Engineering Manager, United Kingdom at Kira. London Area, hybrid with a minimum of 3 days per week on-site. Full-time, mid-senior.

Kira seeks an Engineering Manager to lead high-performing engineering teams building products for millions of users across Southeast Asia. The role demands a technical leader capable of managing engineers, making sound architecture decisions and driving products from concept to production while maintaining engineering quality and delivery speed.

Responsibilities:
- Lead and manage engineers across frontend, backend and full-stack development.
- Own engineering delivery for major product areas, shipping rapidly without compromising reliability.
- Collaborate with product, design, mobile, backend and AI teams on technical execution.
- Drive technical architecture across APIs, databases, integrations and infrastructure.
- Establish engineering standards for code quality, system design, testing, observability, security and reliability.
- Participate in architecture reviews, code reviews, debugging and critical decisions.
- Develop engineers through feedback, coaching and performance management.
- Improve engineering processes, tooling and automation for scale.
- Own production outcomes: monitoring, incident resolution, root cause analysis.

Requirements:
- Strong software engineering background with production system experience.
- Leadership or management experience with software engineers.
- Technical depth in backend, frontend, APIs, databases, distributed systems or cloud infrastructure.
- Sound judgment on architecture and technical trade-offs.
- Track record shipping products from concept through launch and production.
- Strong people leadership, coaching and team-building.
- Product sense connecting engineering to customer and business outcomes.

Interview process: online assessment, technical and engineering leadership interview, CEO final round, targeted at one week for strong candidates.`,

  "c3-ai--forward-deployed-team-lead": `Forward Deployed Team Lead at C3 AI. London, England. Full-time, mid-senior.

Senior technical leaders who own customer engagements end-to-end, combining strong technical architecture, hands-on coding, product ownership, project management and stakeholder communication.

Responsibilities:
- Technical architecture ownership across customer infrastructure.
- Hands-on production coding: backend services, data pipelines, APIs, integrations.
- Deployment roadmap and statement of work execution.
- Project management including plans, milestones, risks and dependencies.
- Customer stakeholder communication and executive briefings.
- Production deployment across dev, UAT and production environments.
- Enterprise security and compliance configuration.
- Field learnings integration into the core platform.
- Account growth and expansion opportunity identification.

Requirements:
- BS or MS in Computer Science, Software Engineering or equivalent experience.
- 6+ years shipping production software; 2+ years as tech lead or senior contributor.
- Proficiency in Python, TypeScript/JavaScript, Java, Go or C++.
- Demonstrated zero-to-production system ownership in commercial or enterprise settings.
- Deep expertise in financial services, healthcare, energy, manufacturing or defence.
- Experience with mid-market or enterprise stakeholder management.
- Familiarity with cloud data warehouses, REST and GraphQL APIs, ERP and CRM platforms.
- Modern deployment practices: CI/CD, Docker, Kubernetes, infrastructure-as-code.

Preferred: prior SaaS or enterprise software tech lead or staff engineer experience; AI/ML platform deployment at scale; AWS, Azure or GCP; regulated industry background.`,

  "via-fruition-group--engineering-manager-frontend-new-platform": `Engineering Manager via Fruition Group. Leeds, England, but FULLY REMOTE. Salary up to £90k plus benefits.

Hands-on leadership position combining people management with technical oversight, building high-performing teams while delivering quality products across engineering, product, design and data functions.

Leadership:
- Lead and develop software engineering teams.
- Foster a collaborative, inclusive culture emphasising learning.
- Support career growth through feedback and mentoring.

Delivery:
- Own end-to-end product initiative delivery.
- Drive engineering excellence via testing, CI/CD, documentation and code quality.
- Monitor and enhance delivery metrics and reliability.

Collaboration:
- Partner with Product, Design and Data teams on customer solutions.
- Communicate priorities, technical trade-offs and delivery risks.
- Maintain team alignment with business objectives.

Technical leadership:
- Guide architecture and technical decisions.
- Participate in design discussions and code reviews.
- Support teams on complex challenges.

Requirements:
- Experience leading and developing engineering teams.
- Strong software engineering background with technical influence.
- Track record delivering complex products in agile settings.
- Experience improving engineering practices and delivery performance.
- Excellent communication and stakeholder management.
- Remote and distributed team leadership experience.

Stack: Ruby on Rails, React, React Native, GraphQL, with hands-on involvement required.`,

  "artificial-labs--lead-forward-deployed-engineer": `Lead Forward Deployed Engineer at Artificial Labs. London, England, hybrid 2-3 days per week on-site. Full-time, mid-senior.

Lead a team configuring and delivering technical solutions for insurance and insurtech clients using Brossa, a domain-specific functional programming language.

Responsibilities:
- Lead analysis of client business requirements and translate them into robust technical solutions.
- Manage and mentor a team of Forward Deployed Engineers.
- Own design, configuration and delivery of insurance product specifications across multiple lines of business.
- Act as trusted technical partner to clients, shaping solutions aligned with strategic goals.
- Collaborate with product, engineering and commercial teams on platform customisation.
- Build and manage platform integrations ensuring reliable delivery.
- Demonstrate product value to senior stakeholders.

Requirements:
- Strong programming foundation, comfortable with domain-specific or functional languages.
- Proven team leadership experience building high-performing cultures.
- Clear communication with technical and non-technical stakeholders.
- Thrive in fast-changing scale-up environments with autonomy.
- Excellent analytical and problem-solving skills.

Preferred: insurtech or insurance industry experience; distributed work environment experience.`,

  "via-hunter-bond--software-engineering-manager": `Software Engineering Manager via Hunter Bond. London, hybrid. Salary £110,000. NOTE: the posting states it is no longer accepting applications.

A Software Engineering Manager position at a large enterprise organisation focused on digital transformation. The role involves leading multiple Agile engineering teams delivering digital products and platforms at enterprise scale, combining people leadership, technical strategy and delivery excellence.

Responsibilities cover strategic leadership and delivery, technical leadership and architecture, Agile governance and continuous improvement, stakeholder and partner management, product innovation, and people leadership and development.

Requirements:
- 10+ years software engineering experience, minimum 3 years as Engineering Manager or similar.
- Proven success delivering enterprise web and mobile platforms in Agile environments.
- Experience leading multiple engineering teams on complex digital products.
- Strong technical background in React, React Native and Node.js.
- Software architecture and scalable system design knowledge.
- DevOps practices and CI/CD pipeline implementation experience.
- Agile delivery experience, SAFe or equivalent preferred.
- Stakeholder management and technical-to-business translation.
- Experience implementing AI or machine learning initiatives.`,

  "disco--engineering-manager": `Engineering Manager at DISCO. Remote, London, England. Full-time, mid-senior.

DISCO is an industry-standard platform for managing and organising music and media. The Engineering Manager combines technical expertise with leadership to guide a product engineering team, balancing feature delivery with system quality and reliability. The role emphasises both hands-on technical contribution and people management.

Responsibilities:
- Define and track OKRs with Product and Design; balance feature development against technical debt.
- Guide technical discovery, review architecture decisions and contribute to development as needed.
- Mentor engineers through 1:1s, career development plans and structured feedback.
- Collaborate with Product and Design on technical feasibility and solution quality.
- Establish and implement engineering standards across teams.
- Monitor engineering health metrics: SLOs, error rates, cycle time, costs.
- Oversee incident response, post-mortems and resolution.
- Drive improvements in development workflows, testing and CI/CD pipelines.

Requirements:
- Proven experience leading engineering teams in high-growth or complex product environments.
- Deep understanding of scalable web applications, APIs and distributed systems.
- Strong knowledge of modern backend and frontend technologies.
- Ability to balance business priorities with technical debt.
- Cross-functional collaboration with Product and Design.
- Familiarity with monitoring, incident response and service reliability at scale.

Bonus: React, TypeScript, Python and PostgreSQL; high-scale SaaS or cloud background; modern DevOps and CI/CD; observability tooling.

Benefits: five weeks paid vacation, paid sick leave, paid parental leave, laptop and office allowance, monthly internet allowance, annual learning budget, remote structure with an international team.`,

  "baringa--senior-manager-forward-deployed-ai-engineer": `Senior Manager, Forward Deployed AI Engineer at Baringa. London, England. Full-time, mid-senior.

Baringa's Solutions and AI Labs practice seeks an experienced Senior Manager to lead AI-enabled consulting engagements, combining technical depth with commercial acumen and leadership.

Engagement leadership:
- Direct end-to-end delivery of complex AI and technology consulting projects, accountable for scope, quality, risk and outcomes.
- Lead multidisciplinary teams of engineers, data scientists and consultants.
- Manage resourcing, forecast team needs and develop junior talent through mentoring.
- Communicate technical complexity to both technical teams and senior client stakeholders.

Business development:
- Identify opportunities and shape propositions for AI and technology engagements.
- Support or lead bids and tender responses, authoring technical sections.
- Build client relationships as a trusted advisor.

Technical architecture and delivery:
- Lead architecture design for AI-enabled platforms and cloud solutions.
- Provide hands-on technical direction, reviewing designs and code.
- Drive production-grade AI deployments beyond proof-of-concept.

AI/ML expertise: agentic AI and LLM engineering including production agentic systems with major LLM SDKs, RAG, MCP servers and prompt engineering; machine learning engineering across the end-to-end lifecycle with MLOps and drift detection; software engineering with production Python services, React and Next.js frontends, cloud architecture and CI/CD.

Requirements:
- 7+ years technology consulting, software engineering or AI/ML experience.
- Minimum 3 years senior leadership with accountability for end-to-end engagements and commercial outcomes.
- Experience supporting or leading bid and proposal activities.
- SME-level depth in one of agentic AI/LLM, machine learning, or software engineering.
- Master's degree in a relevant discipline or equivalent professional certifications.

Desirable: forward-deployed or embedded engineer experience; regulated industries such as energy, financial services or public sector.`,

  "perk--engineering-manager-london": `Engineering Manager, London at Perk. London, England, office-based 3 days weekly. Full-time, mid-senior.

Lead and develop a team of 8-10 software engineers, serving as a servant leader accountable for delivery and career development while maintaining technical excellence.

Responsibilities:
- Team leadership with accountability for the delivery and personal development of your teams.
- Technical oversight: ensure systems meet organisational standards and support architecture decisions.
- Strategic planning: develop a long-term roadmap aligned with product and tribe mission.
- Performance management: conduct effective reviews celebrating achievements and identifying growth.
- Recruitment: actively participate in growing the engineering team.
- Collaboration across Product and Engineering to deliver customer-focused solutions.
- Metrics-driven approach using business and team data.

Requirements:
- 5-8 years managing software engineers.
- Prior hands-on software engineering background as an individual contributor.
- Experience leading larger teams with delegation systems.
- Strong people management building effective team culture.
- Problem-solving skills both technically and organisationally.
- Managing AI-driven development: experience with, or strong interest in, modern AI-augmented workflows.
- Adaptability in fast-changing environments.`,

  "via-gravitas-recruitment--software-engineering-manager-leeds": `Software Engineering Manager, Leeds. Hybrid, 2 days per week on-site. Salary £70,000-£80,000. Full-time, mid-senior.

Build and lead the Software Engineering function alongside the Head of Technology and Data. A hybrid position combining hands-on technical leadership with team development and strategic delivery as the company scales.

Responsibilities:
- Hire and develop Software Engineers, building the team from the ground up.
- Provide technical leadership and coaching.
- Drive delivery ownership and ensure project success.
- Implement design patterns and scalable software architecture.
- Plan and execute CI/CD strategies and deployment pipeline improvements.
- Identify and implement automated testing opportunities.
- Manage stakeholder communication and solve technical problems.

Requirements:
- Strong technical expertise in .NET, Azure cloud development and deployment, SQL databases, messaging and integration patterns, caching.
- Proven track record leading and coaching Software Engineers.
- Comprehensive hands-on SDLC knowledge from design through deployment.
- Agile methodology and engineering best practice proficiency.
- Design pattern implementation and scalable architecture experience.
- CI/CD strategy planning and execution.
- Strong communication and stakeholder management.
- Valid driving licence.

Nice to have: engineering KPI definition and SLA tracking; structured code review experience; secure development and cloud governance knowledge.`,

  "hackajob--forward-deployed-ai-engineer-senior-manager": `Forward Deployed AI Engineer, Senior Manager, listed via hackajob. London, England. Full-time, mid-senior.

This position leads AI and technology consulting engagements within Baringa Partners' Solutions and AI Labs practice. The role combines deep technical specialism with the commercial and leadership skills to develop AI-enabled solutions embedded in client environments.

Engagement leadership: direct end-to-end delivery of complex AI consulting projects accountable for scope, quality and outcomes; lead multidisciplinary teams of engineers, data scientists and consultants; manage resource forecasting and talent development; communicate with both technical teams and senior stakeholders.

Business development: identify opportunities and lead bids for AI and technology engagements; author technical sections of proposals and RFP responses; build client relationships and develop follow-on opportunities.

Technical architecture and delivery: design AI-enabled platforms and cloud solutions; provide hands-on technical direction and code reviews; drive robust, scalable deployments from prototype to production.

AI/ML specialism, expert level in at least one of agentic AI and LLM engineering, machine learning engineering, platform and cloud engineering, or software engineering.

Requirements:
- 7+ years in technology consulting, software engineering or AI/ML, minimum 3 years in senior leadership.
- Experience supporting or leading bids and proposals.
- SME-level expertise in at least one AI/ML or engineering domain.
- Proven ability to lead high-performing teams in complex environments.
- Master's degree in a relevant discipline or equivalent professional certifications.`,

  "accenture-uk-ireland--forward-deployed-eng-director": `Forward Deployed Eng Director at Accenture UK & Ireland. London, England. Director level, full-time. NOTE: the posting states it is no longer accepting applications.

This is a production engineering position, not consulting or research. A Forward Deployed Engineer works embedded inside a client's enterprise, shoulder to shoulder with their teams, to make complex AI platforms work in real organisational environments. Success is measured by outcomes: time-to-value, adoption, reliability and scalability, not delivery milestones.

Responsibilities:
- Own account-level AI transformation from platform selection through enterprise-wide adoption.
- Hold full accountability for deployment outcomes, reported directly to client executive leadership.
- Drive ambiguity resolution at scale, translating strategic intent into production AI systems.
- Define enterprise AI architecture standards and governance frameworks.
- Own relationships with client CTO, CFO and CISO.
- Codify reusable deployment patterns and playbooks.
- Lead executive workshops and board-level engagements.
- Define the FDE practice model including engineering standards and talent development.

Requirements:
- Significant cloud-native systems experience: APIs, microservices, containerisation, serverless.
- Deep expertise designing and deploying agentic solutions in production.
- Experience with AI platforms including OpenAI, Claude, Vertex AI and open-source models.
- Substantial software engineering team leadership experience.
- Demonstrated end-to-end delivery ownership in client-embedded environments.
- Proven ability to quantify deployment impact in business terms.
- Experience presenting to senior stakeholders at CTO, CFO and CISO level.`,

  "sotheby-s--engineering-manager": `Engineering Manager at Sotheby's. London, England, or remote within the UK.

Engineering Manager at Sotheby's, a global art and luxury goods company. The role involves building and leading distributed engineering teams supporting auction platforms, client-facing products and internal systems. Your work connects to something tangible across inventory management, compliance infrastructure and live sale operations.

Responsibilities:
- Own team health, output and growth across distributed time zones.
- Partner with product management on roadmap prioritisation.
- Establish quality standards for engineering practices and observability.
- Manage delivery cadence including planning and retrospectives.
- Handle cross-team dependencies and incident management.
- Contribute to engineering-wide initiatives.
- Provide regular feedback and career development.

Requirements:
- 3+ years managing teams of five or more engineers.
- Strong technical background in software engineering.
- Experience with remote-first, distributed teams across time zones.
- Track record in hiring, onboarding and retention.
- Focus on engineering quality and observability.

Useful: Go, Scala, React and TypeScript, Next.js, GraphQL, gRPC; AWS and Kubernetes; real-time or high-value transaction systems; e-commerce or auction domain background.`,

  "accenture-uk-ireland--forward-deployed-engineering-manager": `Forward Deployed Engineering (Manager) at Accenture UK & Ireland. London, England. Full-time, mid-senior.

Lead enterprise AI platform deployments across complex multi-stakeholder client environments, owning programmes from architecture through adoption.

Responsibilities:
- Direct enterprise AI platform rollouts involving Anthropic, OpenAI, Microsoft, Google, Salesforce, SAP or Palantir.
- Own programme-level delivery: time-to-value, reliability, adoption velocity, scalability with commercial metrics.
- Drive rapid experimentation, moving from ambiguous business problems to production systems in days or weeks.
- Architect and govern enterprise AI solutions across identity, data, security, governance, platform and workflow integration.
- Shape AI strategy for client CTO, CFO and CISO through value architecture, ROI backlogs and multi-year adoption roadmaps.
- Define reusable blueprints, patterns and accelerators that scale across engagements.
- Lead architecture sessions, executive workshops and code-with sessions with engineering and C-suite teams.
- Codify learnings, failure patterns and standards.

Requirements:
- Strong cloud-native systems experience: APIs, microservices, containerisation, serverless.
- Expertise designing and deploying agentic solutions in production including agents, orchestration, context engineering, RAG and workflows.
- Experience with AI platforms including OpenAI, Claude, Vertex AI and open-source models, with multi-provider pipeline abstraction layers.
- Software engineering team leadership: delivery oversight, resource allocation, direct report development.
- Demonstrated end-to-end delivery ownership in client-embedded environments.
- Proven ability to quantify deployment impact in terms a CFO recognises.
- Experience presenting to and building trust with CTO, CFO and CISO-level stakeholders.
- People management experience including performance management and career conversations.`,

  "marks-and-spencer--software-engineering-manager": `Software Engineering Manager at Marks and Spencer. London Area. Full-time, mid-senior.

Join M&S to shape the digital future of a trusted UK brand. This role sits within Fashion Home and Beauty's Commercial Planning subdomain, overseeing a team delivering technical solutions within a large programme alongside vendor and implementation partners.

Responsibilities:
- Ensure operational stability and resilience of software solutions.
- Deliver high-quality software creating measurable business value.
- Foster an innovation culture and establish strong engineering standards.
- Build and mentor high-performing software engineering teams.
- Oversee planning, execution and delivery of software initiatives aligned with business goals.
- Drive adoption of strong engineering practices and methodologies.
- Establish quality standards for performance, reliability and usability.
- Hold vendors and partners accountable for software delivery excellence.
- Challenge solution architecture and guide technical approaches.

Requirements:
- Previous polyglot hands-on senior software engineer experience.
- Experience with highly scalable software solutions across web and backend.
- Extensive background in varied systems and technologies.
- Proven track record building and leading senior engineers.
- Strong system design and cloud architecture knowledge.
- DevOps mindset: build it, you run it.
- Testing strategies and reliability engineering expertise.
- Excellent people management and interpersonal skills.

Stack: Java, Spring, SpringBoot, Micronaut, React, Next.js, TypeScript, Angular, Azure Cloud, Kubernetes, Dynatrace, SQL Server, MongoDB, Ignite, Redis.`,

  "holland-barrett--senior-engineering-manager": `Senior Engineering Manager at Holland & Barrett. London, England. Hybrid with occasional London office presence, approximately twice monthly. Full-time, mid-senior.

Holland & Barrett seeks an experienced Senior Engineering Manager to lead multidisciplinary engineering teams responsible for building digital products supporting merchandising operations. This leadership-focused position emphasises people management, delivery, technical direction and engineering effectiveness. While not hands-on engineering, the role requires technical depth for architecture and system design discussions.

Responsibilities:
- Lead and develop multidisciplinary engineering teams across frontend and backend.
- Build cultures of trust, accountability, ownership and continuous improvement.
- Own engineering delivery and partner with Product Managers on priorities and roadmaps.
- Improve delivery predictability through risk identification and dependency management.
- Provide technical leadership in architecture and system design discussions.
- Champion a you build it, you own it culture emphasising quality and production ownership.
- Enhance engineering practices and Agile methodologies.
- Encourage responsible AI tool adoption for productivity improvements.

Requirements:
- Proven engineering management experience in software product environments.
- Experience leading multidisciplinary frontend and backend teams.
- Strong people leadership with team development and performance management experience.
- Track record owning delivery, roadmap planning and stakeholder communication.
- Understanding of software architecture and technical trade-offs.
- Knowledge of modern engineering practices, automated testing and service ownership.

Benefits: 33 days holiday, private medical insurance, virtual GP, 5% employer pension, life assurance, annual bonus up to 20%, 25% employee discount, wellness programmes, cycle to work.`,

  "yorkshire-building-society--cloud-platform-team-manager": `Cloud Platform Team Manager at Yorkshire Building Society. Leeds, England. Full-time, mid-senior. Financial services.

Lead a high-performing cloud platform engineering team to build, operate and evolve a secure, reliable Azure platform that supports modern software delivery across the organisation.

Responsibilities:
- Lead, coach and develop Cloud Platform Engineers while fostering continuous learning and engineering excellence.
- Provide hands-on technical leadership and architectural oversight across Azure, AKS, Terraform, CI/CD, observability and platform security.
- Own platform reliability, scalability, resilience and cost efficiency with strong governance across networking, identity, monitoring and security.
- Drive roadmap planning, delivery prioritisation and governance aligned with organisational objectives.
- Serve as primary contact for Cloud Platform Engineering, communicating progress and promoting adoption.

Requirements:
- Strong Azure engineering expertise at scale including networking, IAM, security and policies.
- Hands-on experience with infrastructure-as-code, CI/CD and GitOps tools such as Terraform, GitHub Actions and ArgoCD.
- Deep understanding of SRE principles, observability and operational excellence.
- Proven people leadership including coaching, mentoring and team development.
- Strong stakeholder engagement and cross-functional communication.

Benefits: 25 days holiday plus bank holidays with the option to buy 5 more, 7% on-target bonus up to 15%, pension up to 11%, private medical, dental and healthcare plans, flexible working.`,

  "createfuture--tech-lead-mobile": `Tech Lead (Mobile) at CreateFuture. Leeds, England.

CreateFuture is a UK digital consultancy with offices in Edinburgh, Leeds, Manchester and London plus remote staff nationwide. Over 500 employees, partnering with PayPal, Adidas, NatWest and FanDuel.

A hands-on leadership position managing a small, autonomous mobile team embedded with a client. The role spans mobile architecture and technical direction, leading delivery, growing engineers, and direct line management.

Technical leadership:
- Set technical direction across iOS and Android.
- Work hands-on in the codebase alongside engineers for coaching and modelling.
- Drive AI-assisted delivery with reusable skills and spec-driven development.
- Maintain code quality and healthy, maintainable codebases.

Team and people leadership:
- Foster a collaborative, ownership-taking culture.
- Grow engineers to own work rather than wait for direction.
- Provide mentoring, technical guidance and performance feedback.
- Manage line management accountabilities.

Client and delivery:
- Understand product, users and business strategy.
- Route appropriate work to appropriate people, ensuring delivery.
- Communicate delivery status and escalate issues with options and recommendations.
- Maintain an asynchronous, cross-timezone working rhythm.

Requirements:
- Experienced tech lead or senior mobile engineer maintaining technical expertise.
- Strong iOS (Swift) and Android background; Kotlin Multiplatform a bonus.
- Product-focused mindset.
- High tolerance for ambiguity and genuine independence.
- Excellent written, asynchronous communication.
- Line management experience.
- Comfortable with difficult conversations and concrete feedback.`,
};
