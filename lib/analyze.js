// Shared analysis call — used by both the public /api/analyze endpoint
// and the admin regenerate endpoint, so the Anthropic call + JSON parsing
// only lives in one place.

import { buildSystemPrompt } from "./profile.js";
import { complete } from "./anthropic.js";
import { parseLooseJson } from "./json.js";
import { createHash } from "node:crypto";

const hash = text => createHash("sha256").update(text).digest("hex");
const promptHash = hash(buildSystemPrompt({}).stable);
export function analysisContext(instructions = "") {
  return { prompt: promptHash, instructions: hash(String(instructions).trim()) };
}

// ref is whatever the caller already has to key this call to — a job id, a
// report id, or "public" for the unauthenticated path, which has neither yet
// when the call is made. It is only for later drill-down; the daily rollup
// does not need it.
export async function runAnalysis(jobDescription, { instructions, model, ref } = {}) {
  const { text: raw } = await complete({
    model,
    // Headroom matters more than it looks. Short sentences mean more of them,
    // a 6-category report with 5 differentiators overran 4096, and adding the
    // internal scoring block overran 8192. This is a ceiling, not a spend:
    // unused budget costs nothing, a truncated response costs the whole call.
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
    throw Object.assign(new Error("Could not parse the analysis. Try again."), { status: 502 });
  }
  const result = splitInternal(parsed);
  result.report.generation = analysisContext(instructions);
  return result;
}

// The model returns a private "internal" triage block alongside the public
// analysis. It is pulled off here and never travels with the report, so a saved
// report cannot leak a score even if something later serialises the whole
// object. The score lives on the pipeline row instead, behind the admin secret.
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
