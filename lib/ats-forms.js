import { createHash } from "node:crypto";
import { discardResponseBody } from "./http-response.js";
import { retryAfterDate } from "./linkedin-request.js";

// Public job-board APIs of three applicant tracking systems. Only documented,
// unauthenticated read endpoints are used, and the request URL is built here
// from a parsed target, never taken from a payload:
//   Greenhouse  GET boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}?questions=true&pay_transparency=true
//               (the only one that publishes the application form's questions)
//   Lever       GET api.lever.co/v0/postings/{site}/{id}  (posting facts; no custom questions)
//   Ashby       GET api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true
//               (posting facts; the application form API needs a key, so no questions)
// Anything else, and any question Lever or Ashby forms ask, is pasted by Bernardo.
export const ATS_PROVIDERS = ["greenhouse", "lever", "ashby"];
export const MAX_FORM_QUESTIONS = 30;
const QUESTION_LIMIT = 2000;

const abort = message => Object.assign(new Error(message), { abort: true });
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._%-]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const httpsUrl = value => {
  try { const url = new URL(String(value || "").trim()); return url.protocol === "https:" && !url.username && !url.password ? url : null; }
  catch { return null; }
};
const plain = value => String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

// { provider, board, id, region, url } for a supported posting or apply URL, or null.
export function detectAts(value) {
  const url = httpsUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  const target = (provider, board, id, region = "") => SLUG.test(board || "") && id ? { provider, board, id, region, url: url.toString() } : null;
  const gh = /^(?:boards|job-boards)\.(eu\.)?greenhouse\.io$/.exec(host);
  if (gh) {
    const region = gh[1] ? "eu" : "";
    if (parts[0] === "embed" && parts[1] === "job_app") {
      const id = url.searchParams.get("token") || "";
      return /^\d{1,20}$/.test(id) ? target("greenhouse", url.searchParams.get("for"), id, region) : null;
    }
    return parts[1] === "jobs" && /^\d{1,20}$/.test(parts[2] || "") ? target("greenhouse", parts[0], parts[2], region) : null;
  }
  const lever = /^jobs\.(eu\.)?lever\.co$/.exec(host);
  if (lever) return UUID.test(parts[1] || "") ? target("lever", parts[0], parts[1].toLowerCase(), lever[1] ? "eu" : "") : null;
  if (host === "jobs.ashbyhq.com") return UUID.test(parts[1] || "") ? target("ashby", parts[0], parts[1].toLowerCase()) : null;
  return null;
}

// The job's own URL first, then the first supported link in its description or notes.
export function findAtsTarget(job) {
  const direct = detectAts(job?.sourceUrl);
  if (direct) return direct;
  const text = `${job?.jobDescription || ""}\n${job?.notes || ""}`;
  for (const [link] of text.matchAll(/https:\/\/[^\s<>"')\]]+/g)) {
    const found = detectAts(link.replace(/[.,;:!?]+$/, ""));
    if (found) return found;
  }
  return null;
}

export function atsApiUrl(target) {
  if (!target || !ATS_PROVIDERS.includes(target.provider) || !SLUG.test(target.board || "")) return "";
  const board = encodeURIComponent(decodeURIComponentSafe(target.board));
  if (target.provider === "greenhouse" && /^\d{1,20}$/.test(target.id || ""))
    return `https://boards-api.${target.region === "eu" ? "eu." : ""}greenhouse.io/v1/boards/${board}/jobs/${target.id}?questions=true&pay_transparency=true`;
  if (target.provider === "lever" && UUID.test(target.id || ""))
    return `https://api.${target.region === "eu" ? "eu." : ""}lever.co/v0/postings/${board}/${target.id}`;
  if (target.provider === "ashby" && UUID.test(target.id || ""))
    return `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`;
  return "";
}
function decodeURIComponentSafe(value) { try { return decodeURIComponent(value); } catch { return value; } }

// Stable across sources and re-checks, so a state Bernardo set survives.
export const questionId = text => `q_${createHash("sha256").update(plain(text).toLowerCase()).digest("hex").slice(0, 12)}`;

// Contact details and uploads are filled by hand, never drafted.
const CONTACT = /^(?:first name|last name|full name|(?:preferred|legal) (?:first )?name|name|e-?mail(?: address)?|phone(?: number)?|mobile(?: number)?|resume(?:\s*\/\s*cv)?|cv|cover letter|linkedin(?: profile| url)?|website|portfolio(?: url)?|github(?: url)?|twitter(?: url)?|current (?:company|employer)|location(?: \(city\))?)\b[\s*:?]*$/i;
const STANDARD_FIELDS = new Set(["first_name", "last_name", "email", "phone", "resume", "resume_text", "cover_letter", "cover_letter_text", "location"]);

function greenhouseQuestions(body) {
  const out = [];
  for (const question of Array.isArray(body?.questions) ? body.questions : []) {
    const fields = Array.isArray(question?.fields) ? question.fields : [];
    const label = plain(question?.label);
    if (!label || !fields.length || CONTACT.test(label)) continue;
    if (fields.every(field => STANDARD_FIELDS.has(field?.name) || field?.type === "input_file" || field?.type === "input_hidden")) continue;
    const description = plain(question.description);
    const text = (description && description.length < 300 ? `${label} (${description})` : label).slice(0, QUESTION_LIMIT);
    const options = fields.flatMap(field => Array.isArray(field?.values) ? field.values.map(v => plain(v?.label)).filter(Boolean) : []).slice(0, 30);
    const long = fields.some(field => field?.type === "textarea");
    out.push({ id: questionId(text), text, required: !!question.required, options, limit: long ? 150 : 60 });
  }
  return out;
}

const salaryText = (min, max, currency, interval) => {
  const amount = value => Number.isFinite(value) && value > 0 ? Math.round(value).toLocaleString("en-GB") : "";
  const range = [amount(min), amount(max)].filter(Boolean).join(" to ");
  return range ? [range, currency || "", interval || ""].filter(Boolean).join(" ") : "";
};

// The posting facts each API gives (salary, place, working pattern), as short text
// the gap check can read, and the questions it publishes. Null when not found.
export function parseAtsResponse(target, body) {
  if (!body || typeof body !== "object") return null;
  if (target.provider === "greenhouse") {
    const pay = (Array.isArray(body.pay_input_ranges) ? body.pay_input_ranges : [])
      .map(r => salaryText((r?.min_cents ?? 0) / 100, (r?.max_cents ?? 0) / 100, r?.currency_type, plain(r?.title))).filter(Boolean);
    return { facts: { title: plain(body.title).slice(0, 200), location: plain(body.location?.name).slice(0, 200), salary: pay.join("; ").slice(0, 300) },
      questions: dedupe(greenhouseQuestions(body)) };
  }
  if (target.provider === "lever") {
    const range = body.salaryRange || {};
    return { facts: { title: plain(body.text).slice(0, 200), location: plain(body.categories?.location).slice(0, 200),
      commitment: plain(body.categories?.commitment).slice(0, 100), workplace: plain(body.workplaceType).slice(0, 50),
      salary: salaryText(range.min, range.max, plain(range.currency), plain(range.interval)).slice(0, 300) }, questions: [] };
  }
  if (target.provider === "ashby") {
    const job = (Array.isArray(body.jobs) ? body.jobs : []).find(j => String(j?.id || "").toLowerCase() === target.id);
    if (!job) return null;
    const pay = job.compensation?.compensationTierSummary || job.compensation?.scrapeableCompensationSalarySummary || "";
    return { facts: { title: plain(job.title).slice(0, 200), location: plain(job.location).slice(0, 200),
      commitment: plain(job.employmentType).slice(0, 100), workplace: plain(job.workplaceType || (job.isRemote ? "Remote" : "")).slice(0, 50),
      salary: plain(pay).slice(0, 300) }, questions: [] };
  }
  return null;
}

const dedupe = questions => {
  const seen = new Set();
  return questions.filter(q => !seen.has(q.id) && seen.add(q.id)).slice(0, MAX_FORM_QUESTIONS);
};

// Retry rules for the ats-form-request child: Trigger owns attempts and delays;
// this only honours a Retry-After and stops on permanent errors.
export function atsRetryPolicy({ error }) {
  if (error?.abort || error?.name === "AbortTaskRunError") return { skipRetrying: true };
  return error?.retryAt ? { retryAt: error.retryAt } : undefined;
}

// One HTTP attempt per child-task attempt (ats-form-request). Returns only the
// compact parsed form, so run outputs stay small. A posting that is gone (404/410)
// returns { form: null }; it will not come back on retry.
export async function fetchAtsPosting({ target, policy }, { signal, fetchRequest } = {}) {
  signal?.throwIfAborted();
  const url = atsApiUrl(target);
  if (!url) throw abort("Unsupported application system");
  const request = fetchRequest || (await import("@trigger.dev/sdk")).retry.fetch;
  const response = await request(url, { method: "GET", redirect: "error", signal, headers: { accept: "application/json" },
    timeoutInMs: policy.requestTimeoutSeconds * 1000,
    retry: { byStatus: {}, timeout: { maxAttempts: 1 }, connectionError: { maxAttempts: 1 } } });
  if (!response.ok) {
    const message = `${target.provider} HTTP ${response.status}`;
    const retryAt = retryAfterDate(response.headers?.get?.("retry-after"));
    discardResponseBody(response);
    if ([408, 425, 429, 500, 502, 503, 504].includes(response.status)) throw Object.assign(new Error(message), { retryAt });
    if ([404, 410].includes(response.status)) return { status: response.status, form: null };
    throw abort(message);
  }
  let body;
  try { body = await response.json(); }
  catch { throw abort(`${target.provider} returned a response that is not JSON`); }
  return { status: response.status, form: parseAtsResponse(target, body) };
}

// Questions Bernardo pastes from any other form: one per line, list markers and
// numbering removed. A trailing * or "(required)" marks a required question.
export function parsePastedQuestions(text) {
  const out = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    let line = raw.replace(/^\s*(?:[-*•–]|\d{1,2}[.)]|q\d*[.:)]|question\s*\d*[.:)])\s*/i, "").replace(/\s+/g, " ").trim();
    const required = /\*\s*$|\(required\)\s*$/i.test(line);
    line = line.replace(/\s*(?:\*|\(required\))\s*$/i, "").trim();
    if (line.length < 3 || CONTACT.test(line)) continue;
    const textValue = line.slice(0, QUESTION_LIMIT);
    out.push({ id: questionId(textValue), text: textValue, required, options: [], limit: 120 });
  }
  return dedupe(out);
}
