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

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/ingest-opportunities.mjs <opportunities.json>");
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

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-admin-secret": secret },
  body: JSON.stringify({ opportunities }),
});

const body = await res.json().catch(() => ({}));
if (!res.ok) {
  // Deliberately does not echo the request, so the secret cannot end up in a log.
  console.error("Ingest failed (" + res.status + "): " + (body.error || "unknown error"));
  process.exit(1);
}

console.log(
  `Sent ${opportunities.length}. Added ${body.added}, refreshed ${body.updated}, skipped ${body.skipped}.`
);
for (const r of body.addedRows || []) {
  console.log("  new: " + r.role + (r.company ? " at " + r.company : ""));
}
