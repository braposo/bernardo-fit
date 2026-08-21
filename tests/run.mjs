// Runs every test file and reports one total.
//
// Each file is a plain node script that mocks fetch, exercises the real
// handlers against the in-memory store, and exits non-zero on failure. No test
// framework, because the project has one dependency and this does not need to
// become two.
//
// Files run in separate processes so module state and the in-memory store do
// not leak between them.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];

const files = readdirSync(here)
  .filter((f) => f.startsWith("test-") && f.endsWith(".mjs"))
  .filter((f) => !only || f.includes(only))
  .sort();

if (!files.length) {
  console.error(only ? "No test files match " + only : "No test files found");
  process.exit(1);
}

let passed = 0, failed = 0, brokenFiles = 0;

for (const f of files) {
  const out = spawnSync(process.execPath, [join(here, f)], { encoding: "utf8" });
  const text = (out.stdout || "") + (out.stderr || "");
  const summary = (text.match(/^passed (\d+), failed (\d+)$/m) || []).slice(1).map(Number);

  if (!summary.length) {
    brokenFiles++;
    console.log("BROKE  " + f.padEnd(26) + " (no summary; exit " + out.status + ")");
    console.log(text.trim().split("\n").slice(-6).map((l) => "         " + l).join("\n"));
    continue;
  }

  passed += summary[0];
  failed += summary[1];
  const label = summary[1] ? "FAIL " : "ok   ";
  console.log(label + "  " + f.padEnd(26) + summary[0] + " passed" + (summary[1] ? ", " + summary[1] + " FAILED" : ""));
  if (summary[1]) {
    console.log(text.split("\n").filter((l) => l.includes("FAIL")).map((l) => "        " + l.trim()).join("\n"));
  }
}

console.log("\n" + "=".repeat(46));
console.log(files.length + " files · " + passed + " passed · " + failed + " failed" + (brokenFiles ? " · " + brokenFiles + " broke" : ""));
process.exit(failed || brokenFiles ? 1 : 0);
