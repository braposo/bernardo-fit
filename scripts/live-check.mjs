// Run a real generation against production, then delete everything it made.
//
// Why this exists: verifying writing quality needs a real model call, and the
// public /api/analyze creates a pipeline row for every analysis. Checking the
// output therefore left fabricated opportunities sitting in the pipeline
// alongside real ones. Seven of them accumulated before anyone noticed.
//
// Nothing here marks test data in production. The script keeps a local ledger
// of exactly what it created and deletes those ids afterwards, so production
// code needs no test-only path.
//
//   node scripts/live-check.mjs run "<job description>"   analyse, record ids
//   node scripts/live-check.mjs list                      what is outstanding
//   node scripts/live-check.mjs clean                     delete all of it
//
// ADMIN_SECRET is read from .env.local, never printed, never passed as an
// argument. Same handling as the ingest script.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const LEDGER = path.join(here, ".live-check-ledger.json");
const BASE = process.env.FIT_ENDPOINT_BASE || "https://fit.bernardoraposo.com";

const PLACEHOLDERS = ["[SENSITIVE]", "[REDACTED]", "encrypted"];

function readSecret() {
  const fromEnv = (process.env.ADMIN_SECRET || "").trim();
  if (fromEnv && !PLACEHOLDERS.includes(fromEnv)) return fromEnv;
  const envPath = path.join(here, "..", ".env.local");
  if (!fs.existsSync(envPath)) return null;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*ADMIN_SECRET\s*=\s*(.*)\s*$/);
    if (m) {
      const v = m[1].replace(/^["']|["']$/g, "").trim();
      return v && !PLACEHOLDERS.includes(v) ? v : null;
    }
  }
  return null;
}

const ledger = () => (fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : []);
const writeLedger = (rows) => fs.writeFileSync(LEDGER, JSON.stringify(rows, null, 2) + "\n");

const secret = readSecret();
if (!secret) {
  console.error("ADMIN_SECRET not usable. Put the real value in fit-app/.env.local.");
  process.exit(2);
}
const H = { "x-admin-secret": secret, "Content-Type": "application/json" };
const cmd = process.argv[2];

if (cmd === "run") {
  const jd = process.argv[3];
  if (!jd || jd.length < 40) {
    console.error("Pass a job description of at least 40 characters.");
    process.exit(2);
  }

  const before = new Set(
    (await (await fetch(BASE + "/api/admin/jobs", { headers: H })).json()).jobs.map((j) => j.id)
  );

  const res = await fetch(BASE + "/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobDescription: jd }),
  });
  const out = await res.json();
  if (!res.ok) {
    console.error("Analysis failed (" + res.status + "): " + (out.error || "unknown"));
    process.exit(1);
  }

  // Whatever row the analysis created is whatever is there now and was not before.
  const after = (await (await fetch(BASE + "/api/admin/jobs", { headers: H })).json()).jobs;
  const created = after.filter((j) => !before.has(j.id));

  const entry = {
    at: new Date().toISOString(),
    reportId: out.id,
    jobIds: created.map((j) => j.id),
    company: out.report && out.report.company,
  };
  writeLedger(ledger().concat([entry]));

  console.log("report " + out.id + " · rows created: " + entry.jobIds.length);
  console.log("read it at " + BASE + "/?r=" + out.id);
  console.log("run `node scripts/live-check.mjs clean` when you are done.");
} else if (cmd === "list") {
  const rows = ledger();
  if (!rows.length) console.log("Nothing outstanding.");
  rows.forEach((r) => console.log(r.at.slice(0, 16) + " · " + (r.company || "?") + " · report " + r.reportId + " · " + r.jobIds.length + " row(s)"));
} else if (cmd === "clean") {
  const rows = ledger();
  if (!rows.length) {
    console.log("Nothing to clean.");
    process.exit(0);
  }
  let jobs = 0, reports = 0;
  for (const r of rows) {
    for (const id of r.jobIds) {
      // Deletion requires an archived row, which is the guard against removing
      // something live. Satisfy it rather than work around it.
      await fetch(BASE + "/api/admin/jobs?id=" + id, {
        method: "PATCH", headers: H, body: JSON.stringify({ archived: true }),
      });
      const d = await fetch(BASE + "/api/admin/jobs?id=" + id, { method: "DELETE", headers: H });
      if (d.ok) jobs++;
    }
    if (r.reportId) {
      const d = await fetch(BASE + "/api/admin/reports?id=" + r.reportId, { method: "DELETE", headers: H });
      if (d.ok) reports++;
    }
  }
  writeLedger([]);
  console.log("deleted " + jobs + " row(s) and " + reports + " fit page(s). Ledger cleared.");
} else {
  console.log("Usage: node scripts/live-check.mjs run \"<job description>\" | list | clean");
  process.exit(2);
}
