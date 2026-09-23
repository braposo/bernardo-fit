import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { createContentClient } from "./client.js";
import { DEFAULT_SETTINGS } from "./analysis-defaults.js";
import groq from "groq";
import {plainText,strip} from './codecs.js';

export const ANALYSIS_SETTINGS_ID = "fit-analysis-settings";
export const ANALYSIS_SETTINGS_QUERY = groq`*[_type == "analysisSettings" && _id == "fit-analysis-settings"][0]{
  _id, _rev, texts[]{key, text}, questions[]{key, type, instructions, criteria, options[]{key, text}},
  dimensions[]{id, label, weight, gap}, facts[]{question, answer}, routineQuestions,
  personalFacts{availability, location, sponsorship}
}`;
const context = new AsyncLocalStorage();
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const invalid = () => Object.assign(new Error("Publish a complete, valid Analysis settings document in Sanity."), {
  status: 503, code: "SANITY_SETTINGS_INVALID", abort: true,
});
const text = value => typeof value === "string" && value.trim().length > 0 && value.length <= 80000;
const sameKeys = (actual, expected) => actual.length === expected.length && new Set(actual).size === actual.length
  && expected.every(key => actual.includes(key));
const substitutions = { candidateProfile: 'candidateProfile', motivationProfile: 'motivationProfile',
  interviewProfile: 'interviewProfile', slopTop: 'slopTop', antiSlop: 'antiSlop', proseRules: 'proseRules' };

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const baseline = freeze({ ...structuredClone(DEFAULT_SETTINGS), fingerprint: hash(DEFAULT_SETTINGS), revision: "code-baseline", legacyScoringCompatible:true });

// Verified against the original migration snapshot, not arbitrary live content.
// Canonicalize object order, but preserve arrays, rich-text structure and all
// candidate inputs. Any editorial change disables legacy-score compatibility.
const IMPORTED_CANDIDATE_SIGNATURE='0c586d757ef8b59408dc6711e0f40e72e74b2dbf272e7851e963d1412b9776a6';
export function candidateContentSignature(candidate) {
  const fields='summary motivationSummary interviewSummary headline location availability workEligibility noticePeriod careerDirection workingPreferences salaryPreferences constraints confirmedAnswers'.split(' ');
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  return hash(canonical({...Object.fromEntries(fields.map(key=>[key,strip(candidate[key])??null])),
    evidence:(candidate.evidence || []).map(e=>strip(e?.body))}));
}

export function settingsFromDocument(doc) {
  if (!doc || ![doc.texts, doc.questions, doc.dimensions].every(v => Array.isArray(v) && v.every(x => x && typeof x === "object"))
    || !sameKeys(doc.texts.map(v => v.key), Object.keys(DEFAULT_SETTINGS.texts))
    || !sameKeys((doc.questions || []).map(v => v.key), Object.keys(DEFAULT_SETTINGS.questions))
    || !sameKeys((doc.dimensions || []).map(v => v.id), DEFAULT_SETTINGS.dimensions.map(v => v.id))) throw invalid();
  const texts = Object.fromEntries(doc.texts.map(v => {
    if (!text(v.text)) throw invalid();
    for (const match of v.text.matchAll(/\{\{([^}]+)\}\}/g)) {
      if (!(match[1] in substitutions) && !["coverMaxWords", "refusal"].includes(match[1])) throw invalid();
    }
    return [v.key, v.text];
  }));
  const questions = {};
  for (const q of doc.questions) {
    const original = DEFAULT_SETTINGS.questions[q.key];
    if (q.type !== original.type || !text(q.instructions)) throw invalid();
    questions[q.key] = { type: q.type, instructions: q.instructions };
    if (q.type === "score") {
      if (!Array.isArray(q.criteria) || q.criteria.length !== 5 || !q.criteria.every(text)) throw invalid();
      questions[q.key].criteria = [...q.criteria];
    } else if (q.type === "choice") {
      if (!sameKeys((q.options || []).map(v => v.key), Object.keys(original.criteria)) || !q.options.every(v => text(v.text))) throw invalid();
      questions[q.key].criteria = Object.fromEntries(Object.keys(original.criteria).map(key => [key, q.options.find(v => v.key === key).text]));
    }
  }
  const dimensions = DEFAULT_SETTINGS.dimensions.map(original => {
    const value = doc.dimensions.find(v => v.id === original.id);
    if (!text(value.label) || !text(value.gap) || !Number.isInteger(value.weight) || value.weight < 0 || value.weight > 100) throw invalid();
    return { id: value.id, label: value.label, weight: value.weight, criteria: questions[value.id].criteria, gap: value.gap };
  });
  if (dimensions.reduce((sum, v) => sum + v.weight, 0) !== 100) throw invalid();
  if (!Array.isArray(doc.facts) || !doc.facts.every(v => text(v.question) && text(v.answer))
    || !Array.isArray(doc.routineQuestions) || !doc.routineQuestions.every(text)
    || !doc.personalFacts || !Object.keys(DEFAULT_SETTINGS.personalFacts).every(k => text(doc.personalFacts[k]))) throw invalid();
  const normalizedQuestions = doc.facts.map(v => v.question.toLowerCase().trim().replace(/[?!.]+$/, "").replace(/\s+/g, " "));
  if (new Set(normalizedQuestions).size !== normalizedQuestions.length) throw invalid();
  const settings = { texts: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.texts).map(k => [k, texts[k]])),
    questions: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.questions).map(k => [k, questions[k]])), dimensions,
    facts: doc.facts.map(({question, answer}) => ({question, answer})), routineQuestions: [...doc.routineQuestions],
    personalFacts: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.personalFacts).map(k => [k, doc.personalFacts[k]])) };
  const fingerprint=hash(settings);
  return freeze({ ...settings, fingerprint, revision: doc._rev || "published",legacyScoringCompatible:fingerprint===baseline.fingerprint });
}

export const analysisSettings = () => context.getStore() || baseline;
export const settingsFingerprint = () => analysisSettings().fingerprint;
export const settingsText = key => analysisSettings().texts[key];
export const settingsQuestion = key => analysisSettings().questions[key];
export const withSettingsSnapshot = (snapshot, run) => context.run(snapshot, run);

export async function loadAnalysisSettings(env = process.env, client) {
  if (env.SANITY_ANALYSIS_ENABLED !== "1") return baseline;
  try {
    const reader=client || createContentClient(env);
    const settings=settingsFromDocument(await reader.fetch(ANALYSIS_SETTINGS_QUERY));
    if(env.SANITY_CONTENT_ENABLED!=='1')return settings;
    const candidate=await reader.fetch('*[_type == "candidateProfile" && migration.sourceKey == "candidate:bernardo"][0]{...,evidence[]->}');
    if(!candidate || !plainText(candidate.summary).trim())throw invalid();
    const summary=plainText(candidate.summary);
    const extraEvidence=(candidate.evidence || []).map(e=>plainText(e?.body)).filter(text=>text.trim() && !summary.includes(text));
    const preferences=['headline','location','availability','workEligibility','noticePeriod','careerDirection','workingPreferences','salaryPreferences','constraints']
      .filter(k=>candidate[k]).map(k=>`${k}: ${candidate[k]}`).join('\n');
    const mutable=structuredClone(settings);
    mutable.texts.candidateProfile=[summary,...extraEvidence,preferences].filter(Boolean).join('\n\n');
    mutable.texts.motivationProfile=plainText(candidate.motivationSummary) || mutable.texts.candidateProfile;
    mutable.texts.interviewProfile=plainText(candidate.interviewSummary) || mutable.texts.candidateProfile;
    mutable.facts=(candidate.confirmedAnswers || []).map(({question,answer})=>({question,answer}));
    mutable.personalFacts={availability:candidate.availability || '',location:candidate.location || '',sponsorship:candidate.workEligibility || ''};
    delete mutable.fingerprint;delete mutable.revision;delete mutable.legacyScoringCompatible;
    return freeze({...mutable,fingerprint:hash(mutable),revision:`${settings.revision}:${candidate._rev}`,
      legacyScoringCompatible:settings.legacyScoringCompatible && candidateContentSignature(candidate)===IMPORTED_CANDIDATE_SIGNATURE});
  }
  catch (error) {
    if (error.code === "SANITY_SETTINGS_INVALID") throw error;
    throw Object.assign(new Error("Analysis settings could not be loaded from Sanity. Try again."), {
      status: 503, code: "SANITY_SETTINGS_UNAVAILABLE",
    });
  }
}

export async function withAnalysisSettings(run) {
  if (context.getStore()) return run();
  return withSettingsSnapshot(await loadAnalysisSettings(), run);
}

export function renderPrompt(key) {
  // Replace known placeholders once. Published text is never evaluated as code.
  return settingsText(key).replace(/\{\{([^}]+)\}\}/g, (_, name) => {
    if (name === "coverMaxWords") return "430";
    if (name === "refusal") return "CANNOT ANSWER:";
    if (name in substitutions) return settingsText(substitutions[name]);
    throw invalid();
  });
}
