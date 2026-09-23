import { settingsText, renderPrompt } from "./sanity/analysis-settings.js";
import { DEFAULT_SETTINGS } from "./sanity/analysis-defaults.js";
// Baseline export for compatibility and tests. Enabled tasks read the published
// candidate context and prompt templates through their Sanity settings snapshot.

import { instructionsBlock } from "./writing.js";

export const PROFILE_CONTEXT = DEFAULT_SETTINGS.texts.candidateProfile;

// Split so the caller can cache the stable half and send the volatile half
// (my own steering notes for this specific role) uncached alongside it. Every
// job-specific interpolation used to sit inline at the instructionsBlock call
// below; moving it out is the only change here, not a rewrite of the prompt.
export function cacheableWritingPrompt(stable) {
  const values = ["slopTop", "antiSlop", "proseRules", "candidateProfile"].map(settingsText);
  const shared = values.join("\n\n") + "\n\n";
  const taskRules = values.reduce((text, value) => text.replace(value, ""), stable).trim();
  return { shared, stable: shared + taskRules };
}

export function buildSystemPrompt({ instructions } = {}) {
  const stable = renderPrompt('analysis');
  return { ...cacheableWritingPrompt(stable), volatile: instructionsBlock(instructions) };
}
