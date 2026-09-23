import { renderPrompt } from "./sanity/analysis-settings.js";
import { complete } from "./ai.js";
import { parseLooseJson } from "./json.js";
import { DEFAULT_MODEL } from "./models.js";
import { instructionsBlock } from "./writing.js";

import { briefInputs, briefModelInput } from "./brief-inputs.js";
export { briefInputs } from "./brief-inputs.js";

const clean = (v, max = 1800) => String(v || "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max);
function cleanText(value, max = 1800) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item, max)).filter(Boolean).join("\n").slice(0, max);
  }
  if (value && typeof value === "object") {
    return cleanText(value.text ?? value.content ?? value.value ?? value.name ?? value.title ?? "", max);
  }
  return clean(value, max);
}
const safeUrl = (v) => { try { const u = new URL(String(v || "")); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch { return ""; } };

function items(value, sourceIds, limit = 12) {
  return (Array.isArray(value) ? value : []).slice(0, limit).map((v) => {
    const x = typeof v === "string" ? { text: v } : v || {};
    const src = x.src === "posting" ? "posting" : Number.isInteger(Number(x.src)) && sourceIds.has(Number(x.src)) ? Number(x.src) : null;
    return { text: clean(x.text || x.answer || x.question, 1600), src };
  }).filter((x) => x.text);
}

export function normaliseBrief(raw, input, { at = new Date().toISOString(), model = DEFAULT_MODEL } = {}) {
  const sources = (input.research?.sources || []).filter((s) => safeUrl(s.url)).slice(0, 30);
  const ids = new Set(sources.map((s) => Number(s.id)));
  return {
    at, model, stage: "screen", company: input.company, role: input.role,
    contact: cleanText(raw?.contact, 500), opening: cleanText(raw?.opening, 1600), why: items(raw?.why, ids, 8),
    conversation: { notes: input.conversation.notes, receivedAt: input.conversation.receivedAt,
      updatedAt: input.conversation.updatedAt, points: items(raw?.conversation, ids, 10) },
    likelyQuestions: items(raw?.likelyQuestions, ids, 12), gapResponses: items(raw?.gapResponses, ids, 10),
    greenFlags: items(raw?.greenFlags, ids, 10), redFlags: items(raw?.redFlags, ids, 10), questionsToAsk: items(raw?.questionsToAsk, ids, 12),
    companyReference: items(raw?.companyReference, ids, 8), roleReference: items(raw?.roleReference, ids, 8),
    personalAnswers: input.personalFacts, confirmedAnswers: input.confirmedAnswers,
    unknowns: (Array.isArray(raw?.unknowns) ? raw.unknowns : []).slice(0, 15)
      .map((v) => clean(typeof v === "string" ? v : v?.text || v?.question || v?.unknown, 600)).filter(Boolean),
    sources,
  };
}

export async function runBrief({ job, report, research, model = DEFAULT_MODEL, ref }) {
  const input = briefInputs(job, report, research);
  const result = await complete({
    model, effort: "high", maxTokens: 10000, kind: "brief", ref,
    system: { stable: renderPrompt('brief'), volatile: instructionsBlock(job.instructions) },
    messages: [{ role: "user", content: JSON.stringify(briefModelInput(job, report, research)) }],
  });
  const raw = parseLooseJson(result.text, (v) => v && typeof v === "object");
  if (!raw) throw Object.assign(new Error("Screen brief did not return valid structured data."), { status: 502, abort: true });
  return normaliseBrief(raw, input, { model });
}
