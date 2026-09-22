import { renderPrompt } from "./sanity/analysis-settings.js";
import { cacheableWritingPrompt } from "./profile.js";
import { instructionsBlock } from "./writing.js";
import { complete } from "./ai.js";
import { reportEvidence } from "./report.js";
import { answerPolicy } from "./answer-policy.js";
import { recordUsage } from "./usage.js";
import { routeAnswer } from "./jev-routing.js";

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

// Split so the stable half — the rules for how to write any answer, which do
// not depend on which question or which job this is — can be cached, while
// the actual question, the role, and my own notes travel in a second,
// uncached block. Reordered as part of the split, not just split in place:
// the job description used to sit before the profile, which meant the
// profile could never be the start of a shared prefix. It is stable content
// moved later, not new content. The one line that genuinely cannot be
// stable — the word limit, since two questions rarely share one — moves with
// the question it belongs to rather than sitting stranded up top.
export function buildAnswerPrompt({ question, limit, report, jobDescription, previous, instructions, compact = false }) {
  const budget = clampLimit(limit);
  const jd = (jobDescription || (report && report.job_description) || "").trim();

  const stable = renderPrompt('answer');

  const context = `## The role

${jd ? JSON.stringify(jd) : "(no job description captured)"}

${report ? `## My fit analysis for this role

Use it as the source of what genuinely connects. Do not contradict it.

${JSON.stringify(reportEvidence(report))}` : ""}
${instructionsBlock(instructions)}`;
  const volatile = `${priorBlock(previous)}\n\n## The question

${budget} words MAXIMUM for this one.

${JSON.stringify(String(question || "").trim())}`;

  const compactRules = renderPrompt('compactAnswer');
  return { ...(compact ? { stable: compactRules } : cacheableWritingPrompt(stable)), context, volatile };
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

export async function runAnswer({ question, limit, report, jobDescription, previous, instructions, model, ref, economy = false, modelRouting = false }) {
  const q = String(question || "").trim();
  if (q.length < 3) throw Object.assign(new Error("Ask a fuller question."), { status: 400 });

  const budget = clampLimit(limit);
  const base = answerPolicy({ question: q, model, economy, instructions, report });
  const policy = modelRouting ? { ...base, model, routing: "jev-selected" } : await routeAnswer(base,
    { question: q, economy, instructions, report, ref });
  if (policy.fact) {
    await recordUsage({ kind: "answer", ref, model: "", effort: "none", source: "profile", usage: {} });
    return { ...finish(policy.fact, budget), model: "", source: "profile" };
  }
  const system = buildAnswerPrompt({ question: q, limit: budget, report, jobDescription, previous, instructions, compact: policy.compact });

  const { text: raw } = await complete({
    model: policy.model,
    effort: policy.effort,
    maxTokens: 4096,
    system,
    messages: [{ role: "user", content: "Draft the answer." }],
    kind: "answer",
    ref,
  });

  return { ...finish(raw.trim(), budget), model: policy.model, source: "model", routing: policy.routing || "existing-policy" };
}
