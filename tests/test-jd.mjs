// Guards the job description against arriving as a summary.
//
// The scan filled jobDescription with whatever WebFetch returned, and WebFetch
// runs the page through a model first, so the pipeline held a paraphrase: the
// Stora posting was stored as roughly 350 characters against 7,600 on the page.
// Every fit analysis was scored against that summary rather than the job.
//
// Nothing here goes to the network. The HTML fixtures are trimmed from real
// LinkedIn responses, and the ingest cases run against the in-memory store.

import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";
const lib = "file:///" + root + "lib/";

process.env.ADMIN_SECRET = "test-secret-value";
const { htmlToText, postingId } = await import("file:///" + root + "scripts/fetch-jd.mjs");
const store = await import(lib + "store.js");
const ingest = (await import(base + "admin/ingest.js")).default;

let pass = 0, fail = 0;
const check = (n, c, e) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 300) : "")); }
};

console.log("\n--- a posting id is read out of whatever URL shape arrives ---");
check("plain view URL", postingId("https://www.linkedin.com/jobs/view/4460505512") === "4460505512");
check("with tracking", postingId("https://www.linkedin.com/comm/jobs/view/4460505512/?trackingId=abc%3D%3D") === "4460505512");
check("slug URLs carry no id", postingId("https://uk.linkedin.com/jobs/view/engineering-manager-at-la-fosse-123") === "");
check("nothing is not an id", postingId("") === "" && postingId(null) === "" && postingId(undefined) === "");

console.log("\n--- the posting keeps its shape, not just its words ---");
const html = [
  "<p><strong>About Stora</strong></p>",
  "<p>Stora is building the operating platform for modern self-storage businesses.</p>",
  "<p>We&rsquo;re a product-led, remote-first company.</p>",
  "<strong>What you&#39;ll do</strong><ul>",
  "<li>Manage approximately 8 engineers across two teams</li>",
  "<li>Own hiring &amp; performance</li>",
  "<li>Partner with Product &ndash; weekly</li></ul>",
  "<p>Salary: &pound;90,000 &mdash; &pound;110,000</p>",
  "<script>window.tracking = 1;</script>",
  "<p>Line one<br>Line two</p>",
].join("");
const text = htmlToText(html);

check("headings survive as their own lines", /^About Stora$/m.test(text), text.slice(0, 120));
// The requirements list is the part the analysis leans on hardest, so it must
// not come back as one run-on paragraph.
check("list items keep their bullet", (text.match(/^- /gm) || []).length === 3, text);
check("a list item reads whole", /^- Manage approximately 8 engineers across two teams$/m.test(text), text);
check("br becomes a line break", /Line one\nLine two/.test(text), text);
check("named entities decode", text.includes("We’re") && text.includes("hiring & performance"), text);
check("numeric entities decode", text.includes("you'll do"), text);
check("currency and dashes decode", text.includes("£90,000 — £110,000"), text);
check("a list reads as a list, not spaced-out fragments",
  text.includes("- Manage approximately 8 engineers across two teams\n- Own hiring & performance\n- Partner with Product"), text);
check("script contents are dropped", !text.includes("window.tracking"), text);
check("no tags survive", !/[<>]/.test(text), text);
check("no run of blank lines", !/\n\n\n/.test(text), JSON.stringify(text));
check("does not start or end with space", text === text.trim());

console.log("\n--- entities that are not entities are left alone ---");
check("a bare ampersand stays", htmlToText("<p>R&D and Q&A</p>") === "R&D and Q&A", htmlToText("<p>R&D and Q&A</p>"));
check("an unknown entity is left as written", htmlToText("<p>a &notreal; b</p>").includes("&notreal;"));
check("empty in, empty out", htmlToText("") === "" && htmlToText(null) === "");

console.log("\n--- ingest keeps whichever description says more ---");
function mockRes() {
  const r = { statusCode: 0, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r; r.setHeader = () => r;
  return r;
}
const send = async (opportunities) => {
  const res = mockRes();
  await ingest({ method: "POST", headers: { "x-admin-secret": "test-secret-value" }, body: { opportunities } }, res);
  return res.body;
};
const full = "F".repeat(7600);
const summary = "S".repeat(350);

const row = await store.saveJob({
  company: "Stora", role: "Engineering Manager", externalId: "linkedin-4460505512",
  sourceUrl: "https://www.linkedin.com/jobs/view/4460505512", jobDescription: full,
});
const get = async (id) => (await store.listJobs({ includeArchived: true })).find((j) => j.id === id);

await send([{ externalId: "linkedin-4460505512", company: "Stora", role: "Engineering Manager", jobDescription: summary }]);
check("a later summary does not replace the posting", (await get(row.id)).jobDescription === full);

await send([{ externalId: "linkedin-4460505512", company: "Stora", role: "Engineering Manager", jobDescription: "" }]);
check("an empty one does not wipe it", (await get(row.id)).jobDescription === full);

const fuller = "F".repeat(9000);
await send([{ externalId: "linkedin-4460505512", company: "Stora", role: "Engineering Manager", jobDescription: fuller }]);
check("a longer one does replace it", (await get(row.id)).jobDescription === fuller);

const bare = await store.saveJob({ company: "Kira", role: "Engineering Manager", externalId: "linkedin-4453524675" });
await send([{ externalId: "linkedin-4453524675", company: "Kira", role: "Engineering Manager", jobDescription: full }]);
check("a row with none gets one", (await get(bare.id)).jobDescription === full);

console.log("\n--- a full description is long enough to be worth analysing ---");
// The analyse path skips anything under 20 characters, and nothing caps the
// upper end, so the whole posting reaches the model.
check("a real posting clears the floor", full.length >= 20);
check("a summary would have cleared it too, which is why this was invisible", summary.length >= 20);

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
