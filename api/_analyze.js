// Shared analysis call — used by both the public /api/analyze endpoint
// and the admin regenerate endpoint, so the Anthropic call + JSON parsing
// only lives in one place.

import { resolveModel, refusalError } from "./_models.js";
import { buildSystemPrompt } from "./_profile.js";

export async function runAnalysis(jobDescription, { instructions, model } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("Server is missing ANTHROPIC_API_KEY."), { status: 500 });
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: resolveModel(model),
      // Headroom matters more than it looks. Short sentences mean more of them,
      // a 6-category report with 5 differentiators overran 4096, and adding the
      // internal scoring block overran 8192. This is a ceiling, not a spend:
      // unused budget costs nothing, a truncated response costs the whole call.
      max_tokens: 16384,
      system: buildSystemPrompt({ instructions }),
      messages: [
        {
          role: "user",
          content: `Here's the job description. Write my fit analysis:\n\n${jobDescription}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error("Analysis service error"), { status: 502, detail: text.slice(0, 500) });
  }

  const data = await response.json();
  const refused = refusalError(data);
  if (refused) throw refused;
  if (data.stop_reason === "max_tokens") {
    console.error("Model response hit max_tokens before completing.");
  }
  const raw = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  let clean = raw.replace(/```json|```/g, "").trim();
  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    clean = clean.slice(first, last + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    console.error("Failed to parse model output as JSON:", raw);
    throw Object.assign(new Error("Could not parse the analysis. Try again."), { status: 502 });
  }
  return splitInternal(parsed);
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
