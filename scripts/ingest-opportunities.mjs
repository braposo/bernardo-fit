// Posts a batch of opportunities to the live pipeline.
//
//   node scripts/ingest-opportunities.mjs path/to/opportunities.json
//
// The admin secret is read here, from ADMIN_SECRET in the environment or from
// .env.local, and used directly. It is never printed, never passed as an
// argument, and never echoed back, so whoever or whatever assembles the JSON
// does not need to hold the credential.
//
// ADMIN_SECRET is the only variable this script needs. Write it into .env.local
// by hand. `vercel env pull` does not help: the variable is marked Sensitive,
// so the pull writes ADMIN_SECRET="[SENSITIVE]" rather than the value.
//
// Input shape: either a bare array, or { opportunities: [...] }. Each entry
// needs a company or role, plus an externalId or threadId to dedupe on:
//
//   {
//     "externalId": "acme--head-of-engineering",
//     "threadId": "19ff0195e5009249",
//     "company": "Acme",
//     "role": "Head of Engineering",
//     "source": "LinkedIn InMail — Jane Smith",
//     "sourceType": "recruiter-inmail",
//     "sourceUrl": "https://www.linkedin.com/jobs/view/123",
//     "location": "Remote UK",
//     "salary": "£120k",
//     "receivedAt": "2026-08-18T09:00:00Z",
//     "jobDescription": "...",
//     "replyOwed": true,
//     "recruiter": { "name": "Jane Smith", "org": "Acme Talent", "daysWaiting": 0 }
//   }

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fetchDescription, postingId } from "./fetch-jd.mjs";

const ENDPOINT = process.env.FIT_ENDPOINT || "https://fit.bernardoraposo.com/api/admin/ingest";

// A variable marked Sensitive in Vercel cannot be read back. env pull still
// writes the name, with one of these standing in for the value, so the secret
// looks present and then fails as a 401. Treat them as missing.
const PLACEHOLDERS = ["[SENSITIVE]", "[REDACTED]", "encrypted"];

function clean(raw) {
  const v = String(raw).replace(/^["']|["']$/g, "").trim();
  if (!v || PLACEHOLDERS.includes(v)) return null;
  return v;
}

function readSecret() {
  if (process.env.ADMIN_SECRET) return clean(process.env.ADMIN_SECRET);
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return null;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*ADMIN_SECRET\s*=\s*(.*)\s*$/);
    if (m) return clean(m[1]);
  }
  return null;
}

const args = process.argv.slice(2);
const noFetch = args.includes("--no-fetch");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: node scripts/ingest-opportunities.mjs <opportunities.json> [--no-fetch]");
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error("No such file: " + file);
  process.exit(2);
}

const secret = readSecret();
if (!secret) {
  console.error(
    "ADMIN_SECRET not usable.\n" +
      "If .env.local shows ADMIN_SECRET=\"[SENSITIVE]\", the variable is marked Sensitive in Vercel and its value cannot be pulled back.\n" +
      "Open fit-app/.env.local and replace that line with the real secret, or set ADMIN_SECRET in the environment."
  );
  process.exit(2);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (err) {
  console.error("Could not parse " + file + ": " + err.message);
  process.exit(2);
}
const opportunities = Array.isArray(parsed) ? parsed : parsed.opportunities;
if (!Array.isArray(opportunities)) {
  console.error("Expected an array, or an object with an `opportunities` array.");
  process.exit(2);
}
if (!opportunities.length) {
  console.log("Nothing to send.");
  process.exit(0);
}

// Fill in the real job description before sending. What the scan collects is
// whatever WebFetch returned, and WebFetch summarises, so without this step the
// pipeline holds a paraphrase and every fit analysis is scored against it
// rather than against the posting.
if (!noFetch) {
  const needing = opportunities.filter((o) => postingId(o.sourceUrl) && (o.jobDescription || "").length < 1500);
  if (needing.length) {
    console.log("Fetching " + needing.length + " job description" + (needing.length === 1 ? "" : "s") + "...");
    for (const o of needing) {
      const was = (o.jobDescription || "").length;
      const { text, status } = await fetchDescription(postingId(o.sourceUrl));
      if (text && text.length > was) {
        o.jobDescription = text;
        console.log("  " + was + " -> " + text.length + " chars  " + (o.role || "") + (o.company ? " at " + o.company : ""));
      } else {
        console.log("  kept " + was + " chars (" + (text ? "fetched shorter" : "fetch " + status) + ")  " + (o.role || ""));
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
}

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-admin-secret": secret },
  body: JSON.stringify({ opportunities, requestId: randomUUID() }),
});

const body = await res.json().catch(() => ({}));
if (!res.ok) {
  // Deliberately does not echo the request, so the secret cannot end up in a log.
  console.error("Ingest failed (" + res.status + "): " + (body.error || "unknown error"));
  process.exit(1);
}

if (!body.runId) {
  console.error("Ingest was accepted without a run id.");
  process.exit(1);
}
console.log(`Sent ${opportunities.length}. Waiting for background ingest ${body.runId}...`);
const statusUrl = new URL(ENDPOINT.replace(/\/ingest\/?$/, "/cover"));
statusUrl.searchParams.set("run", body.runId);
let completed;
for (let attempt = 0; attempt < 900; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const statusResponse = await fetch(statusUrl, { headers: { "x-admin-secret": secret } });
  const status = await statusResponse.json().catch(() => ({}));
  if (!statusResponse.ok) {
    console.error("Could not read ingest status (" + statusResponse.status + "): " + (status.error || "unknown error"));
    process.exit(1);
  }
  if (status.terminal) {
    if (status.status !== "COMPLETED") {
      console.error("Ingest failed: " + (status.error || status.status));
      process.exit(1);
    }
    completed = status.result || {};
    break;
  }
}
if (!completed) {
  console.error("Ingest is still running after 30 minutes. Run id: " + body.runId);
  process.exit(1);
}
console.log(`Added ${completed.added}, refreshed ${completed.updated}, skipped ${completed.skipped}.`);
for (const r of completed.addedRows || []) {
  console.log("  new: " + r.role + (r.company ? " at " + r.company : ""));
}
// Sent as new, folded into a row that already existed. Worth reading: it means
// the externalId composed for this role does not match the one composed for it
// last time, which is how duplicates used to get in.
for (const r of completed.mergedRows || []) {
  console.log(
    "  already known (" + r.matchedOn + "): " + r.role + (r.company ? " at " + r.company : "") +
      "  sent as " + r.sentAs
  );
}
