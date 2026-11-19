// Recognises a newly found posting as an opening Bernardo already has, so scans
// and imports record the repost instead of adding (and paying to assess) it again.
//
// The same listing is handled by store.findExistingJobIn (pipeline) and by the
// filtered record's own identity. This module covers reposts under a new listing: cheap rules first, then Jev for the close calls
// the rules cannot settle.
import { createHash } from "node:crypto";
import { evaluateJev } from "./jev.js";
import { duplicateSettings } from "./sanity/analysis-settings.js";
import { linkedinPostingId, mutateJob } from "./store.js";

const normalise = value => String(value || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const words = value => value.split(" ").filter(Boolean);

// "Acme Ltd", "ACME Limited", "via Acme", "Acme SAS", "Acme UK" and "Acme
// (via hackajob)" are one company. Job sites other than LinkedIn often add the
// legal entity or country to the employer's name.
const LEGAL = new Set(["ltd", "limited", "plc", "inc", "incorporated", "llc", "llp", "gmbh", "co", "corp",
  "corporation", "sas", "sa", "bv", "ag", "ab", "oy", "srl", "group", "holdings", "uk", "ireland", "the"]);
export const companyKey = value => words(normalise(String(value || "").replace(/\([^)]*\)/g, " ")).replace(/^via /, ""))
  .filter(w => !LEGAL.has(w)).join(" ");
export const titleKey = value => normalise(value);

// The first part of a LinkedIn location, without "Greater"/"Area". Country or
// remote-only locations say nothing about which office, so they match any place.
const BROAD_PLACES = new Set(["", "united kingdom", "uk", "england", "scotland", "wales", "northern ireland",
  "great britain", "gb", "remote", "europe", "emea", "anywhere", "worldwide", "global"]);
const PLACE_NOISE = new Set(["greater", "area", "metropolitan", "city", "of", "remote", "hybrid", "fully", "first", "based", "home", "listing"]);
export function placeKey(location) {
  const place = words(normalise(String(location || "").split(/[,;(/\u2013\u2014]| or | - /i)[0]))
    .filter(w => !PLACE_NOISE.has(w)).join(" ");
  return BROAD_PLACES.has(place) ? "" : place;
}

// Words that say where or how a role is worked, not what it is. Job sites
// other than LinkedIn add these to the employer's title ("Hiring: ...",
// "Remote ...", "(m/f/d)", "(Permanent)", "... Job in Islington").
const TITLE_NOISE = new Set(["uk", "remote", "hybrid", "the", "and", "of", "for", "a", "an", "in", "at", "to", "with",
  "hiring", "permanent", "perm", "full", "time", "m", "f", "d", "w", "x"]);
const cleanTitle = value => String(value || "").replace(/\bjob in\b.*$/i, " ");
const titleWords = value => new Set(words(titleKey(cleanTitle(value))).filter(w => !TITLE_NOISE.has(w)));
export function titleSimilarity(a, b) {
  const x = titleWords(a), y = titleWords(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}
// Low on purpose: aggregators rename "Engineering Manager" to "Remote
// Engineering Manager, AI-Driven Editing Experience". Jev, not the title,
// decides; the bar only keeps unrelated roles at the same company apart.
const NEAR_TITLE = 0.25;

// records: pipeline/archived jobs ({ kind: "job" }) and filtered jobs
// ({ kind: "filtered" }), pipeline first so a repost lands on the live row.
// Returns { rules } (same company, title and place) and { near } (the closest
// other same-company records for Jev, most similar first).
export function findRepeat(posting, records, { maxComparisons = 4 } = {}) {
  const company = companyKey(posting.company);
  const title = titleKey(posting.role);
  if (!company || !title) return { rules: [], near: [] };
  const listing = linkedinPostingId(posting);
  const place = placeKey(posting.location);
  const rules = [], near = [];
  for (const record of records) {
    // The same listing is not a repost: the pipeline match updates it and a
    // filtered record is refreshed by its next screen.
    if (listing && linkedinPostingId(record) === listing) continue;
    if (companyKey(record.company) !== company) continue;
    const sameTitle = titleKey(record.role) === title;
    const otherPlace = placeKey(record.location);
    if (sameTitle && (!place || !otherPlace || place === otherPlace)) { rules.push(record); continue; }
    const similarity = sameTitle ? 1 : titleSimilarity(posting.role, record.role);
    if (similarity >= NEAR_TITLE) near.push({ record, similarity });
  }
  near.sort((a, b) => b.similarity - a.similarity);
  return { rules, near: near.slice(0, maxComparisons).map(({ record }) => record) };
}

// Share of distinct longer words two descriptions have in common.
const descriptionWords = text => new Set(String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3));
export function descriptionOverlap(a, b) {
  const x = descriptionWords(a), y = descriptionWords(b);
  if (!x.size || !y.size) return null;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}
// Reposts keep their text; recruiters reuse generic titles for different roles.
const SAME_DESCRIPTION = 0.8;

const DESCRIPTION_LIMIT = 6000;
// Job sites other than LinkedIn often carry only a few sentences rewritten
// from the employer's posting. Jev is told which side is the short one.
const SUMMARY_LENGTH = 1500;
const brief = (record, description) => {
  const text = String(description || "");
  return { company: String(record.company || ""), role: String(record.role || ""),
    location: String(record.location || ""), postedDate: String(record.postedDate || ""),
    source: String(record.source || ""),
    descriptionKind: !text.trim() ? "missing" : text.length < SUMMARY_LENGTH ? "summary" : "full",
    description: text.slice(0, DESCRIPTION_LIMIT) };
};

// Asks Jev whether the posting repeats any of the near records. Returns the
// most likely repeat at or above the published probability, or null.
export async function judgeRepeat(posting, near, { settings = duplicateSettings(), evaluate = evaluateJev,
  describe = async record => record.jobDescription || "" } = {}) {
  if (!settings || !near.length) return null;
  const existing = {};
  for (const [index, record] of near.entries()) existing[`e${index}`] = brief(record, await describe(record));
  const questions = Object.fromEntries(Object.keys(existing).map(key => [`repeat_${key}`, {
    type: "choice",
    instructions: `${settings.instructions}\n\nCompare state.posting with state.existing["${key}"] only.`,
    criteria: { repeat: settings.repeatCriteria, different: settings.differentCriteria },
  }]));
  const state = { posting: brief(posting, posting.jobDescription), existing };
  const ref = "repeat-" + createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 16);
  const { answers } = await evaluate({ state, questions, kind: "job-repeat-check", ref });
  let best = null;
  for (const [index, record] of near.entries()) {
    const answer = answers?.[`repeat_e${index}`];
    const probability = answer?.probabilities?.repeat;
    if (!Number.isFinite(probability) || !["repeat", "different"].includes(answer.choice))
      throw new Error("Jev returned no valid repost answer.");
    if (answer.choice === "repeat" && probability >= settings.repeatProbability && (!best || probability > best.probability))
      best = { repeat: record, by: "jev", probability };
  }
  return best;
}

// The rules first, then Jev for the close calls. `describe` loads an existing
// record's description.
export async function checkRepeat(posting, records, { settings = duplicateSettings(), evaluate,
  describe: load = async record => record.jobDescription || "" } = {}) {
  const descriptions = new Map();
  const describe = record => {
    if (!descriptions.has(record)) descriptions.set(record, load(record));
    return descriptions.get(record);
  };
  const found = findRepeat(posting, records, { maxComparisons: settings?.maxComparisons });
  // A rule match stands unless both descriptions are known and differ: then it
  // is a different role under a generic title, or an edited repost for Jev.
  const unsettled = [];
  for (const record of found.rules) {
    const overlap = descriptionOverlap(posting.jobDescription, await describe(record));
    if (overlap === null || overlap >= SAME_DESCRIPTION) return { repeat: record, by: "rules" };
    unsettled.push(record);
  }
  // A reworded title over the same description text is a repost too. The same
  // title in another city stays with Jev: employers post one text per office.
  const near = [...unsettled, ...found.near].slice(0, settings?.maxComparisons || 4);
  for (const record of found.near) {
    if (!near.includes(record) || titleKey(record.role) === titleKey(posting.role)) continue;
    const overlap = descriptionOverlap(posting.jobDescription, await describe(record));
    if (overlap !== null && overlap >= SAME_DESCRIPTION) return { repeat: record, by: "rules" };
  }
  return await judgeRepeat(posting, near, { settings, evaluate, describe }) || null;
}

// What a repost adds to the record it repeats.
export function repostEntry(posting, match, now = new Date()) {
  return { externalId: String(posting.externalId || ""), sourceUrl: String(posting.sourceUrl || ""),
    role: String(posting.role || ""), location: String(posting.location || ""),
    postedDate: String(posting.postedDate || ""), seenAt: now.toISOString(), matchedBy: match.by,
    ...(Number.isFinite(match.probability) ? { probability: match.probability } : {}) };
}
const sameListing = (a, b) => (a.externalId && a.externalId === b.externalId) || (a.sourceUrl && a.sourceUrl === b.sourceUrl);
export const addRepost = (reposts, entry) =>
  [...(Array.isArray(reposts) ? reposts : []).filter(r => !sameListing(r, entry)), entry].slice(-20);

export async function recordJobRepost(jobId, entry) {
  return mutateJob(jobId, current => current.id ? { reposts: addRepost(current.reposts, entry) } : undefined);
}
