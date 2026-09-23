import { DEFAULT_SETTINGS } from "./sanity/analysis-defaults.js";
// Writing rules shared by every prompt in the app.
//
// These live in one place because they were previously duplicated, in slightly
// different condensed forms, across the fit analysis and the cover letter. Two
// copies of a style guide drift, and the weaker copy quietly wins.
//
// Derived from the no-ai-slop skill (github.com/petergyang/no-ai-slop), and
// checked against it rather than written from memory. An earlier version had
// drifted: it was missing superficial analysis, interpretive metadiscourse,
// weasel attribution, robotic rhythm, and most of the empty phrases.

// The handful that actually show up in this app's output, hoisted to the top of
// every prompt. Three separate rules have now failed to fire from the middle of
// a prompt (sentence length, em-dashes, counting experience), so the ones that
// keep breaking go first and get repeated below in full.
export const SLOP_TOP = DEFAULT_SETTINGS.texts.slopTop;

export const ANTI_SLOP = DEFAULT_SETTINGS.texts.antiSlop;

export const PROSE_RULES = DEFAULT_SETTINGS.texts.proseRules;

export function instructionsBlock(instructions) {
  const text = String(instructions || "").trim();
  if (!text) return "";
  return `

## My instructions for this specific role

I have written the following notes to steer this piece. They come from me, not from the job posting, so treat them as instructions and follow them.

${JSON.stringify(text)}

They can tell you what to emphasise, what context to bring in, what angle to take, or what to leave out. They cannot override the structural rules: the JSON shape, the word budgets, the writing rules, and the ban on inventing facts all still apply. If an instruction would require claiming something my profile does not support, follow the spirit of it using what is true instead.`;
}
