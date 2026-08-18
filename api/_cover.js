import { PROFILE_CONTEXT } from "./_profile.js";

// Cover letter generation.
//
// Length is a layout constraint, not a preference. The template is a fixed
// A4 page (1123px) and the sample letter it was designed around runs to about
// 470 words including the sign-off. Overshoot and the body either spills onto
// a second page or overflows the box, so the budget below is enforced rather
// than suggested, the same way the fit analysis word budgets were.

export const COVER_MAX_WORDS = 430;

function buildCoverPrompt({ report, fitUrl }) {
  return `You are writing a cover letter as Bernardo Raposo, in the first person. It is sent to the company, so it is public-facing writing, not a private note.

${PROFILE_CONTEXT}

## The fit analysis for this role

You have already assessed this role. Use it as your source of what actually connects, and do not contradict it.

${JSON.stringify(report, null, 2)}

## Length is a hard constraint

The letter is laid out on a single fixed A4 page. Going over means the design breaks, so this matters more than any stylistic preference.

- ${COVER_MAX_WORDS} words MAXIMUM across every paragraph combined. Count them.
- 5 to 7 paragraphs, not counting the salutation or the sign-off.
- The first paragraph is the lead and should be one or two short sentences, no more.
- Aim for about 400 words. Landing under is fine; landing over is a failure.

## Shape

Follow the shape of this real letter of mine, which is the register to hit. Do not reuse its content, only its rhythm and its bluntness:

  Lead: "I've done a version of this job before, which is why the role caught my attention."
  Then: a specific past role, what I owned, and why it maps onto theirs.
  Then: a second, different piece of evidence, usually the other of TravelRepublic or SingleStore.
  Then: the risk I can see in their situation, and what I do about that kind of risk.
  Then: the honest gap, named plainly and without apology.
  Then: one thing about their specific product or problem that I find genuinely interesting, thought through rather than flattered.
  Close: the fit-analysis link.

Name a real gap. The letter above says "I've led one team rather than several, so the org shape here is a step up in scope for me". That candour is the point of the letter, not a risk to manage.

Be specific about their business. The strongest paragraph in the letter above is the one that thinks about the company's actual product and what could be built there. Generic enthusiasm is worthless; a concrete idea is not.

## Writing rules

Everything the fit analysis follows applies here too:

- Short sentences. Most under 20 words, 25 as a ceiling. One idea per sentence.
- Never use an em-dash. No "—" anywhere. Use a full stop, comma, colon or brackets.
- Banned words: delve, foster, leverage, utilize, facilitate, empower, streamline, robust, cutting-edge, paradigm shift, game changer, tapestry, realm, beacon, multifaceted, meticulous, intricate, paramount, transformative, elevate, embark, supercharge, harness, ever-evolving.
- Cut empty adverbs: just, literally, simply, actually, truly, fundamentally, importantly, crucially. Cut "it's worth noting", "at the end of the day", "when it comes to". Cut filler "honestly".
- No binary contrasts ("it's not X, it's Y"), no throat-clearing openers, no rhetorical questions, no importance puffery, no fake-profound closing metaphor.
- Numbers only where they establish real scale. Never cite document page counts, GitHub stars, npm downloads or promotion grades.
- Contractions. Write the way I speak.
- Never open with "I am writing to apply for" or any variant. Start with substance.

## Output

Respond with ONLY valid JSON, no markdown fence, in this shape:

{
  "salutation": "Dear Hiring Team,",
  "paragraphs": [
    { "lead": true, "html": "First paragraph. Wrap the single sharpest phrase in <span class=\\"em\\">like this</span>, once only." },
    { "html": "Body paragraph. You may wrap one clause in <em>like this</em> for emphasis, sparingly." }
  ]
}

Rules for the html field: plain text plus, at most, <span class="em"> in the lead and <em> elsewhere. No other tags, no links, no line breaks. The closing fit-analysis paragraph is appended automatically, so do not write one.

If you know the company name, address the salutation to the team by name, for example "Dear Sanity team,". Otherwise keep "Dear Hiring Team,".${fitUrl ? "" : ""}`;
}

export async function runCoverLetter({ report, fitUrl }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error("Server is missing ANTHROPIC_API_KEY."), { status: 500 });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 8192,
      system: buildCoverPrompt({ report, fitUrl }),
      messages: [{ role: "user", content: "Write the cover letter." }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error("Cover letter service error"), { status: 502, detail: text.slice(0, 400) });
  }

  const data = await response.json();
  if (data.stop_reason === "max_tokens") console.error("Cover letter hit max_tokens before completing.");

  const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  let clean = raw.replace(/```json|```/g, "").trim();
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) clean = clean.slice(first, last + 1);

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    console.error("Failed to parse cover letter as JSON:", raw.slice(0, 500));
    throw Object.assign(new Error("Could not parse the cover letter. Try again."), { status: 502 });
  }

  return normalise(parsed, fitUrl);
}

// Strips anything the template can't render, and appends the fit-page line.
function normalise(parsed, fitUrl) {
  const allowed = /<\/?(?:em|span class="em")>/g;
  const strip = (s) =>
    String(s || "")
      .replace(/<(?!\/?em\b|span class="em")[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const paragraphs = (Array.isArray(parsed.paragraphs) ? parsed.paragraphs : [])
    .map((p) => ({ lead: !!p.lead, html: strip(p && p.html) }))
    .filter((p) => p.html);

  if (fitUrl) {
    const shown = fitUrl.replace(/^https?:\/\//, "");
    paragraphs.push({
      lead: false,
      fit: true,
      html:
        "I also built a tool that reads a job spec against my background and gives an honest read, gaps included. This role's is at " +
        `<a href="${fitUrl}">${shown}</a>`,
    });
  }

  return {
    salutation: strip(parsed.salutation) || "Dear Hiring Team,",
    paragraphs,
    words: paragraphs.reduce((n, p) => n + p.html.replace(/<[^>]*>/g, " ").trim().split(/\s+/).length, 0),
    generatedAt: new Date().toISOString(),
  };
}
