// Shared analysis call — used by both the public /api/analyze endpoint
// and the admin regenerate endpoint, so the Anthropic call + JSON parsing
// only lives in one place.

import { buildSystemPrompt } from "./profile.js";
import { complete } from "./ai.js";
import { parseLooseJson } from "./json.js";
import { createHash } from "node:crypto";
import { generationEffort } from "./generation-context.js";
import { settingsFingerprint } from "./sanity/analysis-settings.js";

const hash = text => createHash("sha256").update(text).digest("hex");
export function analysisContext(instructions = "") {
  return { prompt: hash(buildSystemPrompt({}).stable), settings: settingsFingerprint(), instructions: hash(String(instructions).trim()), effort: generationEffort("analyse") };
}

// ref is whatever the caller already has to key this call to — a job id, a
// report id, or "public" for the unauthenticated path, which has neither yet
// when the call is made. It is only for later drill-down; the daily rollup
// does not need it.
export async function runAnalysis(jobDescription, { instructions, model, ref } = {}) {
  const { text: raw } = await complete({
    model,
    // Leave headroom for the page; unused output budget costs nothing.
    maxTokens: 16384,
    system: buildSystemPrompt({ instructions }),
    messages: [
      {
        role: "user",
        content: `Here's the job description. Write my fit analysis:\n\n${jobDescription}`,
      },
    ],
    kind: "analyse",
    ref,
  });

  // Shares its repair passes (trailing commas, an unescaped inner quote) with
  // the cover letter's parser, which is where they were first written for a
  // real failure. This analysis had none of those fallbacks before; it can
  // only gain successful parses, never lose one it used to get.
  const parsed = parseLooseJson(raw);
  if (!parsed) {
    console.error("Failed to parse analysis JSON", { ref, characters: raw.length });
    throw Object.assign(new Error("Could not parse the analysis. Try again."), { status: 502, abort: true });
  }
  // Ignore unsolicited legacy scoring even when a model returns it.
  const result = { report: stripInternal(parsed), internal: null };
  result.report.generation = analysisContext(instructions);
  return result;
}

// Compatibility parser for historical reports. New generation discards this
// block entirely; only Jev produces new pipeline scores.
export function splitInternal(parsed) {
  const { internal, ...report } = parsed || {};
  const b = (internal && internal.breakdown) || {};
  const num = (v) => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);

  const clean = internal
    ? {
        score: num(internal.score),
        tier: typeof internal.tier === "string" ? internal.tier : "",
        breakdown:
          num(b.location) !== null || num(b.aiDx) !== null || num(b.leadership) !== null
            ? { location: num(b.location), aiDx: num(b.aiDx), leadership: num(b.leadership) }
            : null,
        reasoning: typeof internal.reasoning === "string" ? internal.reasoning : "",
      }
    : null;

  return { report, internal: clean };
}

// Defence in depth: strip the block from anything on its way to a visitor, in
// case a report was saved by an older version that kept it inline.
export function stripInternal(report) {
  if (!report || typeof report !== "object") return report;
  if (!("internal" in report)) return report;
  const { internal, ...rest } = report;
  return rest;
}
