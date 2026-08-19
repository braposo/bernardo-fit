import { PROFILE_CONTEXT } from "./_profile.js";
import { ANTI_SLOP, PROSE_RULES, instructionsBlock } from "./_writing.js";

export const DEFAULT_LIMIT = 120;
export const MIN_LIMIT = 20;
export const MAX_LIMIT = 500;

// Answers come back as plain text rather than JSON. The cover letter taught
// this lesson: JSON buys structure, and an answer has no structure to lose, so
// all it buys here is a class of parse failures. A refusal is a sentinel prefix
// for the same reason.
export const REFUSAL = "CANNOT ANSWER:";

export function clampLimit(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, v));
}

export function countWords(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}

function priorBlock(previous) {
  const done = (previous || []).filter((p) => p.q && p.a);
  if (!done.length) return "";
  return `

## What I have already said on this application

These answers are going into the same form, and the reader will see them together.

${done.map((p, i) => `${i + 1}. Q: ${p.q}\n   A: ${p.a}`).join("\n\n")}

Do not repeat their evidence. If an answer above already leans on SingleStore, reach for TravelRepublic, EDITED, Emirates, Critical Software or my own projects instead. Repeating one example across a form makes it look like I only have one story. Where the honest answer really does need the same role again, come at it from a different angle and say something new about it.`;
}

export function buildAnswerPrompt({ question, limit, report, jobDescription, previous, instructions }) {
  const budget = clampLimit(limit);
  const jd = (jobDescription || (report && report.job_description) || "").trim();

  return `You are drafting my answer to a question on a job application form. Write as me, in the first person. The finished text goes into a form field exactly as you return it, so it has to be usable without editing.

## Read this first: the length is a hard limit

${budget} words MAXIMUM. Application forms enforce their limits and cut off anything over, so going over is a failure however well written. Count the words before you finish. Landing under is fine.

## Answer the question that was asked

Not the question you would prefer. If it asks why this company, do not write about why the role. If it asks for a specific example, give one specific example rather than a summary of my career.

## Two kinds of question, two kinds of answer

Some questions are factual: right to work, sponsorship, notice period, location, availability, willingness to travel. Answer these in a single short sentence, straight from my profile. No preamble, no story. "No, I have UK Settled Status and do not need sponsorship." That is a complete answer, and padding it out makes it worse.

Everything else is a question about judgement or experience. Those get real prose within the budget, grounded in something I have actually done.

## Never invent a fact

If the honest answer needs something my profile does not contain, do not fill the gap. Respond with exactly "${REFUSAL}" followed by one sentence saying what is missing, and nothing else.

This applies hardest to anything with a number attached that only I can decide: salary expectations, a notice period my profile does not state, a start date. Do not guess a range, and do not hedge your way to a plausible-looking figure. Refuse and let me answer it.

Refuse for a missing fact. Do not refuse because a question is broad or awkward, which is most of them.

## Writing rules

This gets read alongside other candidates and their answers, most of which are AI-written. It must not read like one.

${ANTI_SLOP}

${PROSE_RULES}

Two that matter especially in a form answer:

- No throat-clearing. Never open with "That is a great question", "I believe that", or by restating the question. Start with the answer.
- No summing up. A closing sentence that restates what you just said burns words the limit does not have.
${priorBlock(previous)}

## The role

${jd ? JSON.stringify(jd) : "(no job description captured)"}

${report ? `## My fit analysis for this role

Use it as the source of what genuinely connects. Do not contradict it.

${JSON.stringify({ ...report, job_description: undefined }, null, 2)}` : ""}

## My profile

${PROFILE_CONTEXT}
${instructionsBlock(instructions)}

## The question

${JSON.stringify(String(question || "").trim())}

## Output

Return ONLY the answer text. No preamble, no quotation marks around it, no markdown, no heading, no sign-off. Plain prose the way it should appear in the form field. The only exception is the refusal sentinel described above.`;
}

// Exported so the shaping can be tested without a model call.
export function finish(raw, budget) {
  let text = String(raw || "").trim();

  // Strip a fence or wrapping quotes if one slipped through anyway.
  text = text.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
  if (text.length > 1 && /^".*"$/s.test(text)) text = text.slice(1, -1).trim();

  const i = text.toUpperCase().indexOf(REFUSAL);
  if (i !== -1) {
    return {
      refused: true,
      reason: text.slice(i + REFUSAL.length).trim() || "It needs something my profile does not cover.",
      answer: "",
      words: 0,
      limit: budget,
      over: false,
      answeredAt: new Date().toISOString(),
    };
  }

  const words = countWords(text);
  return {
    refused: false,
    reason: "",
    answer: text,
    words,
    limit: budget,
    // Reported rather than enforced by truncation, which would cut mid-sentence
    // and hand back something worse than what the model wrote.
    over: words > budget,
    answeredAt: new Date().toISOString(),
  };
}

export async function runAnswer({ question, limit, report, jobDescription, previous, instructions }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error("Server is missing ANTHROPIC_API_KEY."), { status: 500 });

  const q = String(question || "").trim();
  if (q.length < 3) throw Object.assign(new Error("Ask a fuller question."), { status: 400 });

  const budget = clampLimit(limit);
  const system = buildAnswerPrompt({ question: q, limit: budget, report, jobDescription, previous, instructions });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: "Draft the answer." }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error("Answer service error"), { status: 502, detail: text.slice(0, 400) });
  }

  const data = await response.json();
  if (data.stop_reason === "max_tokens") {
    console.error("Answer hit max_tokens before completing.");
  }

  const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return finish(raw, budget);
}
