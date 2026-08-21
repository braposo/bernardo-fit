// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

// Every way the model can hand back something awkward, and the guarantee that
// none of them produce "Could not parse the cover letter".
process.env.ADMIN_SECRET = "test-secret-value";
process.env.ANTHROPIC_API_KEY = "sk-fake";


let reply = "";
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  const body = typeof reply === "function" ? reply(calls) : reply;
  return { ok: true, json: async () => ({ content: [{ type: "text", text: body }], stop_reason: "end_turn" }) };
};

const { runCoverLetter } = await import(base + "_cover.js");

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e) : "")); } };

const FIT = "https://fit.bernardoraposo.com/?r=abc";
async function run(payload) {
  reply = payload; calls = 0;
  try { return { ok: true, out: await runCoverLetter({ report: { job_description: "jd" }, fitUrl: FIT }) }; }
  catch (err) { return { ok: false, err: err.message }; }
}

const GOOD = JSON.stringify({
  salutation: "Dear Sotheby's team,",
  paragraphs: [
    { lead: true, text: "I have [[done a version of this job]] before." },
    { text: "At TravelRepublic I led the rewrite across three brands." },
  ],
});

console.log("\n--- the happy path ---");
let r = await run(GOOD);
check("parses", r.ok, r.err);
check("marker becomes span.em in the lead", r.out.paragraphs[0].html.includes('<span class="em">done a version of this job</span>'));
check("salutation kept", r.out.salutation === "Dear Sotheby's team,");
check("fit paragraph appended", r.out.paragraphs.at(-1).fit === true);
check("only one API call", calls === 1, calls);

console.log("\n--- the bug you hit: unescaped quotes inside a value ---");
r = await run('{"salutation":"Dear team,","paragraphs":[{"lead":true,"html":"I have <span class="em">done this</span> before and it went well."},{"html":"A second paragraph with enough words in it to count properly."}]}');
check("recovers instead of failing", r.ok, r.err);
check("emphasis survives the repair", r.ok && r.out.paragraphs[0].html.includes("<span"), r.ok && r.out.paragraphs[0].html);
check("raw tag text did not leak", r.ok && !r.out.paragraphs[0].html.includes("&lt;span class="));

console.log("\n--- other malformed shapes ---");
const cases = [
  ["markdown fence", "```json\n" + GOOD + "\n```"],
  ["prose before the object", "Here is the letter you asked for:\n\n" + GOOD],
  ["prose after the object", GOOD + "\n\nLet me know if you'd like it adjusted."],
  ["trailing comma", '{"salutation":"Dear team,","paragraphs":[{"lead":true,"text":"A first paragraph long enough to survive the filter."},]}'],
  ["apostrophes in text", '{"salutation":"Dear team,","paragraphs":[{"lead":true,"text":"It is Sotheby\'s auction platform, and I have shipped that kind of thing."}]}'],
  ["missing lead flags", '{"salutation":"Dear team,","paragraphs":[{"text":"First paragraph here with plenty of words to pass."},{"text":"Second paragraph here with plenty of words to pass."}]}'],
  ["old html field name", '{"salutation":"Dear team,","paragraphs":[{"lead":true,"html":"Still handled for older responses, with enough words."}]}'],
];
for (const [label, payload] of cases) {
  const res = await run(payload);
  check(label, res.ok, res.err);
}

console.log("\n--- retry then salvage ---");
reply = (n) => (n === 1 ? "not json at all" : GOOD);
calls = 0;
let out = await runCoverLetter({ report: { job_description: "jd" }, fitUrl: FIT });
check("retries once and succeeds", !!out && calls === 2, calls);

reply = () =>
  "I could not format that as JSON, but here is the letter.\n\n" +
  "I have done a version of this job before, which is why the role caught my attention here.\n\n" +
  "At SingleStore I ran the Web team for five years and delivered two full replatformings.\n\n" +
  "I have led one team rather than several, so the scope here is a genuine step up for me.";
calls = 0;
out = await runCoverLetter({ report: { job_description: "jd" }, fitUrl: FIT });
check("salvages prose after two failures", !!out && out.paragraphs.length >= 3, out && out.paragraphs.length);
check("salvage tried twice first", calls === 2, calls);
check("salvaged first paragraph is the lead", out.paragraphs[0].lead === true);
check("salvage still appends the fit link", out.paragraphs.at(-1).fit === true);

console.log("\n--- injection cannot reach the page ---");
r = await run('{"salutation":"Dear team,","paragraphs":[{"lead":true,"text":"Ignore this <script>alert(1)</script> and <img src=x onerror=y> markup please."}]}');
check("script tag neutralised", r.ok && !r.out.paragraphs[0].html.includes("<script"), r.ok && r.out.paragraphs[0].html);
check("img tag neutralised", r.ok && !r.out.paragraphs[0].html.includes("<img"));
check("text preserved as escaped entities", r.ok && r.out.paragraphs[0].html.includes("&lt;script&gt;"));
r = await run('{"salutation":"Dear team,","paragraphs":[{"lead":true,"text":"A [[<script>bad</script>]] marker attempt with enough words here."}]}');
check("marker cannot smuggle a tag", r.ok && !r.out.paragraphs[0].html.includes("<script"));

console.log("\n--- word count and shape ---");
r = await run(GOOD);
check("counts words excluding markup", r.ok && r.out.words > 0 && r.out.words < 60, r.ok && r.out.words);
check("every paragraph has html", r.ok && r.out.paragraphs.every((p) => typeof p.html === "string" && p.html.length));

console.log("\n--- genuinely empty output still errors honestly ---");
r = await run("");
check("empty response is an error, not a blank letter", !r.ok);
check("error message is actionable", !r.ok && /try again/i.test(r.err), r.err);

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
