import { PUBLIC_MODEL, resolveModel } from "./models.js";

export const ANSWER_POLICY_VERSION = "2026-09-09-economy-1";
const normalize = question => String(question || "").toLowerCase().trim().replace(/[?!.]+$/, "").replace(/\s+/g, " ");

// Exact, single-intent matches only. Country changes, compound questions,
// future sponsorship, start dates and travel commitments must reach the model.
const FACTS = new Map([
  ["do you need sponsorship to work in the uk", "No, I have UK Settled Status and do not need sponsorship to work in the UK."],
  ["do you require visa sponsorship to work in the uk", "No, I have UK Settled Status and do not need sponsorship to work in the UK."],
  ["do you have the right to work in the uk", "Yes, I have UK Settled Status and the right to work in the UK."],
  ["are you legally authorised to work in the uk", "Yes, I have UK Settled Status and the right to work in the UK."],
  ["are you legally authorized to work in the uk", "Yes, I have UK Settled Status and the right to work in the UK."],
  ["where are you based", "I am based in Harrogate, UK."],
  ["where are you currently based", "I am based in Harrogate, UK."],
  ["are you available now", "Yes, I am available now."],
]);
const ROUTINE = new Set([
  "why us", "why this company", "why this role", "why are you interested in this role",
  "why are you interested in this company", "why do you want to work here",
  "what interests you about this role", "what interests you about this company",
]);

export function answerPolicy({ question, model, economy = false, instructions = "", report }) {
  const q = normalize(question);
  // Trusted steering can change facts, language or format; never bypass it.
  const eligible = economy === true && !String(instructions || "").trim();
  const fact = eligible ? FACTS.get(q) || "" : "";
  const routine = eligible && ROUTINE.has(q) && !!report?.pitch;
  return { fact, compact: routine, model: routine ? PUBLIC_MODEL : resolveModel(model), effort: routine ? "medium" : "high" };
}

// Small, maintained selection from profile.js, supplemented by the role's
// existing fit evidence. Used only for the narrow motivation questions above.
export const MOTIVATION_PROFILE = `Bernardo Raposo works across engineering, design and product, with fifteen-plus years in frontend architecture, design systems, UX, AI products and full-stack work. He is an engineering manager who stays close to implementation and coordinates people and AI agents. He is based in Harrogate, remote-first, available now, with UK Settled Status.
At SingleStore (2020 to May 2026), he hired and ran the Web team, covering the website, Docs v2, CMS infrastructure, the SQRL AI assistant, an MCP integration, analytics, consent and infrastructure. He worked across engineering, product, design, marketing and docs. He left after acquisition-driven restructuring.
At TravelRepublic within Emirates Group, he led a mobile-first Next.js platform shared with Emirates Holidays and Dnata Travel, its React design system and GraphQL service. At EDITED, he built the data-visualisation product and design system, then owned the public website. Earlier he co-founded and ran Connect Coimbra, a profitable coworking business, and built a health-tech web interface at Critical Software.
His strengths are shared systems, connecting engineering with design and product, and simplifying complex products. His approach to AI emphasizes approved evidence, observable behavior and clear boundaries for agents. He built Fit to run his own job search and owns The Hermans. He seeks engineering leadership with an AI, developer-experience or product surface. Use the supplied fit analysis for this role's specific connections and honest gaps. Never invent additional personal facts or company knowledge.`;
