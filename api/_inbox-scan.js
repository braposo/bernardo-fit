// Opportunities extracted from a Gmail scan of the last ~45 days (Aug 2026).
//
// This is a captured snapshot, not a live integration. The app has no Gmail
// credentials of its own; the scan was run separately and the results pasted
// here so the admin page can import them without the server ever touching an
// inbox. Re-import is idempotent, matched on threadId.
//
// To refresh: re-run the inbox scan, replace this array, redeploy, and hit
// "Import from inbox" again. Existing entries keep their stage and notes.

export const INBOX_OPPORTUNITIES = [
  {
    company: "CINC Systems",
    role: "Principal DesignOps Engineer",
    source: "Riviera Partners — Alex Reeder",
    sourceType: "recruiter-email",
    threadId: "19fa8e8a11fc30ec",
    location: "Fully remote (worldwide)",
    salary: "",
    receivedAt: "2026-07-28T13:27:21Z",
    notes:
      "Three emails: intro 28 Jul, follow-up 4 Aug, soft close 11 Aug (\"if the timing isn't right, that's fine\"). Not replied to. Starred in Gmail.",
    jobDescription: `Principal DesignOps Engineer at CINC Systems, reporting directly to the CTO.

CINC Systems is a leading SaaS platform powering 50k+ property associations across the US. They are rebuilding their platform from the ground up and need a Principal DesignOps Engineer to own it all: design system, component libraries, Figma-to-code pipelines, and how AI gets woven into the UX. Real ownership, CTO-level visibility.

The person in this role will own making their entire design pipeline AI-native while the product scales to 14 million users. Suited to someone who enjoys 0 to 1 work in a highly evolving technological environment.

Fully remote, can be located anywhere in the world.`,
  },
  {
    company: "Smart energy company (via DigiTech Resourcing)",
    role: "Software Engineering Team Lead",
    source: "LinkedIn InMail — Matt Taylor, DigiTech Resourcing",
    sourceType: "linkedin-inmail",
    threadId: "19ff0195e5009249",
    location: "Harrogate, 2 days per week in office",
    salary: "£90,000 - £100,000",
    receivedAt: "2026-08-11T09:13:40Z",
    notes: "Local to Harrogate. Not replied to. Client company not named in the InMail.",
    jobDescription: `Software Engineering Team Lead, reporting to the CTO. Harrogate, 2 days per week in the office. Smart energy sector. Salary £90,000 - £100,000.

A smart technology company driving innovation within the energy sector, creating solutions across hardware, software, and cloud services to unlock the power of customer data insights. Reporting to the CTO, you play a key role in the development and release of their products.

You will lead a high-performing engineering team responsible for building and scaling a B2B SaaS platform that delivers energy insights from IoT devices through a customer-facing portal and real-time data streams. This role combines hands-on technical leadership with people management, ensuring the team delivers reliable, scalable, and secure solutions that turn complex IoT data into actionable intelligence for customers, and provides an end-to-end customer experience.

Experience needed:
- Bachelor's or master's degree in computer science or related field.
- Proven experience leading software development teams in a SaaS environment.
- Strong background in backend development (APIs, microservices, distributed systems).
- Familiarity with AWS.
- Solid understanding of system scalability, performance optimization, and security.
- Experience with Agile/Scrum methodologies.
- Proven experience leading or mentoring engineering teams.
- Software development using JavaScript or TypeScript with React and Node.js.`,
  },
  {
    company: "Fruition Group",
    role: "Engineering Manager",
    source: "LinkedIn job alert",
    sourceType: "job-alert",
    threadId: "1a00fd55e78c4bdc",
    location: "",
    salary: "",
    receivedAt: "2026-08-17T13:07:14Z",
    notes:
      "Recurring LinkedIn job alert (4 Aug, 11 Aug, 17 Aug). Someone from Fruition Group also viewed the profile twice. Alert only, so no job description captured; paste one in to run a fit analysis.",
    jobDescription: "",
  },
  {
    company: "Gravitas Recruitment Group",
    role: "Software Engineering Manager (Leeds)",
    source: "LinkedIn job alert",
    sourceType: "job-alert",
    threadId: "19ffb3c1a237680c",
    location: "Leeds",
    salary: "",
    receivedAt: "2026-08-13T13:07:25Z",
    notes: "Alert only, no job description captured.",
    jobDescription: "",
  },
  {
    company: "CreateFuture",
    role: "Tech Lead (Mobile)",
    source: "LinkedIn job alert",
    sourceType: "job-alert",
    threadId: "19fd72f801013bda",
    location: "",
    salary: "",
    receivedAt: "2026-08-06T13:07:11Z",
    notes: "Alert only, no job description captured. Mobile focus, likely a weak fit.",
    jobDescription: "",
  },
  {
    company: "Liberty Blume",
    role: "Senior Engineering Support Manager",
    source: "LinkedIn job alert",
    sourceType: "job-alert",
    threadId: "19fc7bc7570c49d1",
    location: "",
    salary: "",
    receivedAt: "2026-08-03T13:07:14Z",
    notes: "Alert only, no job description captured.",
    jobDescription: "",
  },
];
