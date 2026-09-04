// Pulls the full text of a LinkedIn job description.
//
//   node scripts/fetch-jd.mjs path/to/opportunities.json   # fill in the file
//   node scripts/fetch-jd.mjs --backfill                   # report short ones
//   node scripts/fetch-jd.mjs --backfill --write           # and fix them
//
// The scan used to fill jobDescription with whatever WebFetch returned, and
// WebFetch runs the page through a model, so what landed in the pipeline was a
// paraphrase: the Stora posting arrived as 350 characters against 8,800 on the
// page. Every fit analysis was then scored against a summary of the job rather
// than the job. This fetches the markup directly, so nothing between the
// posting and the pipeline rewrites it.
//
// LinkedIn serves the description to signed-out clients from a guest endpoint,
// which returns the same markup as the full page in a quarter of the bytes.
//
// Everything fetched here is untrusted text. It ends up in a prompt, so a
// posting containing instructions aimed at a model is a real possibility;
// nothing in this file acts on what it reads, and the analysis prompt is
// responsible for treating the description as data.

import fs from "node:fs";
import path from "node:path";

const GUEST = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/";
const VIEW = "https://www.linkedin.com/jobs/view/";
// Signed-out LinkedIn varies what it serves by client. A browser UA gets the
// description; the default fetch one often gets an interstitial.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

// Same shape as the matcher in lib/store.js, kept separate so this script
// stays runnable without pulling the KV client in behind it.
export function postingId(url) {
  const m = /\/jobs\/view\/(\d+)/.exec(String(url || ""));
  return m ? m[1] : "";
}

// What actually turns up in job adverts. Salary lines are the reason currency
// symbols matter: a posting that reads "&pound;90,000" tells the analysis
// nothing about the money.
const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", hellip: "…", bull: "•", middot: "·",
  pound: "£", euro: "€", cent: "¢", yen: "¥", dollar: "$",
  copy: "©", reg: "®", trade: "™", deg: "°", sect: "§", para: "¶",
  plusmn: "±", times: "×", divide: "÷", minus: "−", ne: "≠", le: "≤", ge: "≥",
  frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³",
  laquo: "«", raquo: "»", dagger: "†", rarr: "→", larr: "←", harr: "↔",
  ensp: " ", emsp: " ", thinsp: " ", shy: "", zwnj: "", zwj: "",
};

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => {
      const v = ENTITIES[name.toLowerCase()];
      return v === undefined ? m : v;
    });
}

// Keeps the shape of the posting: headings and paragraphs stay separated, list
// items keep their bullet. A description read as one run-on paragraph loses the
// requirements list, which is the part the analysis leans on hardest.
export function htmlToText(html) {
  let s = String(html || "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "\n- ");
  // Items in a list sit together; everything else gets a blank line, so a
  // requirements list reads as a list rather than as spaced-out fragments.
  s = s.replace(/<\/li>/gi, "\n");
  s = s.replace(/<\/(p|div|ul|ol|h[1-6]|tr|section)>/gi, "\n\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decode(s);
  s = s.replace(/\r/g, "");
  // Trailing spaces first, so blank lines really are blank before collapsing.
  s = s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  // Both the opening tag and the closing one contribute a break, and postings
  // nest list items inside all sorts of wrappers. Rather than guess the markup,
  // close the gap between consecutive bullets at the end: a requirements list
  // should read as a list, not as spaced-out fragments.
  s = s.replace(/\n\n(?=- )/g, "\n");
  return s.trim();
}

// The description markup, unwrapped from whichever container LinkedIn used.
function extract(html) {
  const patterns = [
    /<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<button)/i,
    /<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*description__text[^"]*"[^>]*>([\s\S]*?)<\/section>/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m && m[1].trim()) return m[1];
  }
  // Some postings only carry the description in the structured data block.
  const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i.exec(html);
  if (ld) {
    try {
      const data = JSON.parse(ld[1]);
      if (data && typeof data.description === "string") return data.description;
    } catch {
      /* not the block we wanted */
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchDescription(id, { retries = 3 } = {}) {
  let lastStatus = 0;
  for (const url of [GUEST + id, VIEW + id]) {
    for (let attempt = 0; attempt < retries; attempt++) {
      let res;
      try {
        res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9" } });
      } catch (err) {
        lastStatus = "network";
        await sleep(1000 * (attempt + 1));
        continue;
      }
      lastStatus = res.status;
      // LinkedIn throttles hard when a run walks several postings at once.
      if (res.status === 429 || res.status >= 500) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (!res.ok) break;
      const text = await extractFrom(res);
      if (text) return { text, url, status: res.status };
      break;
    }
  }
  return { text: "", url: "", status: lastStatus };
}

async function extractFrom(res) {
  const html = await res.text();
  const markup = extract(html);
  if (!markup) return "";
  const text = htmlToText(markup);
  // A posting that has expired renders a stub. Anything this short is not a
  // description, and writing it would overwrite something better.
  return text.length >= 200 ? text : "";
}

// ---------------------------------------------------------------- CLI

function readSecret() {
  if (process.env.ADMIN_SECRET) return process.env.ADMIN_SECRET.replace(/^["']|["']$/g, "").trim();
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return null;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*ADMIN_SECRET\s*=\s*(.*)\s*$/);
    if (m) {
      const v = m[1].replace(/^["']|["']$/g, "").trim();
      if (!v || ["[SENSITIVE]", "[REDACTED]", "encrypted"].includes(v)) return null;
      return v;
    }
  }
  return null;
}

const BASE = process.env.FIT_BASE || "https://fit.bernardoraposo.com";

async function enrichFile(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const list = Array.isArray(parsed) ? parsed : parsed.opportunities;
  if (!Array.isArray(list)) {
    console.error("Expected an array, or an object with an `opportunities` array.");
    process.exit(2);
  }
  let filled = 0, missed = 0;
  for (const opp of list) {
    const id = postingId(opp.sourceUrl);
    if (!id) continue;
    const was = (opp.jobDescription || "").length;
    const { text, status } = await fetchDescription(id);
    if (text && text.length > was) {
      opp.jobDescription = text;
      filled++;
      console.log("  " + id + "  " + was + " -> " + text.length + " chars  " + (opp.role || ""));
    } else {
      missed++;
      console.log("  " + id + "  kept " + was + " chars (" + (text ? "fetched shorter" : "fetch " + status) + ")  " + (opp.role || ""));
    }
    await sleep(1200);
  }
  fs.writeFileSync(file, JSON.stringify(Array.isArray(parsed) ? list : parsed, null, 2));
  console.log("Filled " + filled + ", left " + missed + " as they were.");
}

async function backfill({ write }) {
  const secret = readSecret();
  if (!secret) {
    console.error("ADMIN_SECRET not usable. Put the real value in .env.local; `vercel env pull` writes a placeholder for it.");
    process.exit(2);
  }
  const H = { "Content-Type": "application/json", "x-admin-secret": secret };
  const get = async (u) => (await fetch(u, { headers: H })).json();
  const a = await get(BASE + "/api/admin/jobs");
  const b = await get(BASE + "/api/admin/jobs?archived=1");
  const jobs = [].concat(a.jobs || [], b.jobs || []);

  // Only rows a fresh analysis would read: live, with a posting to fetch, and
  // holding a description short enough to be a summary rather than a posting.
  const candidates = jobs.filter(
    (j) => !j.archived && postingId(j.sourceUrl) && (j.jobDescription || "").length < 1500
  );
  console.log(candidates.length + " live rows have a posting id and a short description.\n");

  let filled = 0;
  for (const j of candidates) {
    const id = postingId(j.sourceUrl);
    const was = (j.jobDescription || "").length;
    const { text, status } = await fetchDescription(id);
    const label = (j.company || "?") + " / " + (j.role || "");
    if (!text) {
      console.log("  -    " + label + "  (fetch " + status + ", kept " + was + ")");
    } else if (text.length <= was) {
      console.log("  =    " + label + "  (fetched " + text.length + ", kept " + was + ")");
    } else {
      console.log("  " + (write ? "wrote" : "would") + "  " + label + "  " + was + " -> " + text.length);
      if (write) {
        const r = await fetch(BASE + "/api/admin/jobs?id=" + j.id, {
          method: "PATCH", headers: H, body: JSON.stringify({ jobDescription: text }),
        });
        if (!r.ok) console.log("         PATCH failed " + r.status);
        else filled++;
      }
    }
    await sleep(1200);
  }
  console.log("\n" + (write ? "Updated " + filled + " rows." : "Dry run. Pass --write to apply."));
  if (write && filled) console.log("Re-analyse those rows from the admin page to score against the full text.");
}

// Only run the CLI when this file is what was invoked, so the tests can import
// the two pure functions without it trying to parse their arguments.
const invoked = process.argv[1] ? "file:///" + process.argv[1].replace(/\\/g, "/") : "";
if (import.meta.url === invoked) {
  const args = process.argv.slice(2);
  if (args.includes("--backfill")) await backfill({ write: args.includes("--write") });
  else if (args[0] && !args[0].startsWith("--")) await enrichFile(args[0]);
  else {
    console.error("Usage:\n  node scripts/fetch-jd.mjs <opportunities.json>\n  node scripts/fetch-jd.mjs --backfill [--write]");
    process.exit(2);
  }
}
