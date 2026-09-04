// Guards the cache invariant directly: the stable half of each generator's
// prompt must be byte-identical across two different jobs, or every row
// would cost its own cache entry and prompt caching would buy nothing.
//
// This is the test the answer prompt's reorder exists to satisfy — the job
// description used to sit before the profile, which meant the profile could
// never anchor a shared prefix.

import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const lib = "file:///" + root + "lib/";

const { buildSystemPrompt } = await import(lib + "profile.js");
const { buildCoverPrompt } = await import(lib + "cover.js");
const { buildAnswerPrompt } = await import(lib + "answer.js");

let pass = 0, fail = 0;
const check = (n, c, e) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 300) : "")); }
};

// Two different jobs, different companies, different everything, so any
// leak of job-specific text into the stable half shows up as a mismatch
// rather than an accidental coincidence.
const jobA = {
  jd: "Engineering Manager at Vela. Remote UK. Content platform, GraphQL, Next.js.",
  report: {
    job_title: "Engineering Manager", company: "Vela",
    job_description: "Engineering Manager at Vela. Remote UK. Content platform, GraphQL, Next.js.",
    pitch: "p", categories: [{ name: "Technical fit", note: "n" }], differentiators: [], closing: "c",
  },
  question: "Why this role?",
  limit: 80,
};
const jobB = {
  jd: "Head of Platform at Monzo. Hybrid London. Banking infrastructure, Kotlin, AWS.",
  report: {
    job_title: "Head of Platform", company: "Monzo",
    job_description: "Head of Platform at Monzo. Hybrid London. Banking infrastructure, Kotlin, AWS.",
    pitch: "p2", categories: [{ name: "Domain & context", note: "n2" }], differentiators: [{ headline: "h", detail: "d" }], closing: "c2",
  },
  question: "What is your notice period?",
  limit: 200,
};

console.log("\n--- the fit analysis ---");
{
  const a = buildSystemPrompt({});
  const b = buildSystemPrompt({});
  check("stable is byte-identical with no instructions on either side", a.stable === b.stable);
  check("the job description appears nowhere in stable (it goes in the user turn)", !a.stable.includes(jobA.jd) && !a.stable.includes(jobB.jd));

  const steeredA = buildSystemPrompt({ instructions: "Lead on the platform migration." });
  const steeredB = buildSystemPrompt({ instructions: "Mention the crypto rails work." });
  check("stable is unaffected by instructions", steeredA.stable === a.stable && steeredB.stable === a.stable);
  check("but the two different instructions land in two different volatile blocks", steeredA.volatile !== steeredB.volatile);
  check("each instruction is only in its own volatile, not the other's", steeredA.volatile.includes("platform migration") && !steeredA.volatile.includes("crypto rails"));
}

console.log("\n--- the cover letter ---");
{
  const a = buildCoverPrompt({ report: jobA.report, fitUrl: "https://fit.bernardoraposo.com/?r=a" });
  const b = buildCoverPrompt({ report: jobB.report, fitUrl: "https://fit.bernardoraposo.com/?r=b" });
  check("stable is byte-identical across two unrelated jobs", a.stable === b.stable);
  check("the company name appears nowhere in stable", !a.stable.includes("Vela") && !b.stable.includes("Monzo"));
  check("the job description appears nowhere in stable", !a.stable.includes(jobA.jd) && !b.stable.includes(jobB.jd));
  check("job A's specifics are in job A's volatile, not job B's", a.volatile.includes("Vela") && !b.volatile.includes("Vela"));
  check("job B's specifics are in job B's volatile, not job A's", b.volatile.includes("Monzo") && !a.volatile.includes("Monzo"));
  // fitUrl differs between the two calls above (?r=a vs ?r=b) but is never
  // actually interpolated into the prompt text itself, only used by the
  // caller to append the closing paragraph after generation — confirm that
  // stays true, since if it ever moved into the prompt it would break this.
  check("fitUrl does not leak into either half of the prompt", !a.stable.includes("?r=a") && !a.volatile.includes("?r=a"));
}

console.log("\n--- the form answer ---");
{
  const a = buildAnswerPrompt({ question: jobA.question, limit: jobA.limit, report: jobA.report });
  const b = buildAnswerPrompt({ question: jobB.question, limit: jobB.limit, report: jobB.report });
  check("stable is byte-identical across two different questions and jobs", a.stable === b.stable);
  check("neither question appears in stable", !a.stable.includes(jobA.question) && !a.stable.includes(jobB.question));
  check("neither word limit appears in stable", !a.stable.includes("80 words") && !a.stable.includes("200 words"));
  check("the profile is in stable, where it can anchor a shared prefix", a.stable.includes("# Who I am: Bernardo Raposo"));
  check("job A's question is in job A's volatile, not job B's", a.volatile.includes(jobA.question) && !b.volatile.includes(jobA.question));
  check("job A's limit is in job A's volatile, not job B's", a.volatile.includes("80 words") && !b.volatile.includes("80 words"));

  // Same question and job, different limit only — this is the case that most
  // directly proves the limit cannot live in stable: two otherwise-identical
  // calls that must still share a cache entry.
  const c = buildAnswerPrompt({ question: jobA.question, limit: 20, report: jobA.report });
  const d = buildAnswerPrompt({ question: jobA.question, limit: 500, report: jobA.report });
  check("stable is identical even when only the limit changes", c.stable === d.stable);
  check("only the volatile half carries the different limit", c.volatile !== d.volatile);
}

console.log("\n--- what a real request would actually send ---");
{
  // Reconstruct the system array the way lib/anthropic.js builds it, and
  // check the property that actually matters: the first block (the one
  // carrying cache_control) is identical across two unrelated jobs.
  const toBlocks = (p) => [
    { type: "text", text: p.stable, cache_control: { type: "ephemeral" } },
    ...(p.volatile ? [{ type: "text", text: p.volatile }] : []),
  ];
  const a = toBlocks(buildCoverPrompt({ report: jobA.report, fitUrl: "https://x" }));
  const b = toBlocks(buildCoverPrompt({ report: jobB.report, fitUrl: "https://x" }));
  check("the cached block (system[0]) is byte-identical between two jobs", a[0].text === b[0].text);
  check("only system[0] carries the cache marker", !!a[0].cache_control && !a[1].cache_control);
}

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
