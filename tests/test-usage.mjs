// Guards token-usage recording, step 1 of the Trigger.dev migration.
//
// Every generator now records what a call cost after the fact. Nothing here
// changes what a generator does — the point of this file is to prove that a
// stats write can never turn a good generation into a failed one, and that
// the numbers it writes down are the numbers the API actually reported.

import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

process.env.ADMIN_SECRET = "test-secret-value";
const usage = await import(base + "_usage.js");

let pass = 0, fail = 0;
const check = (n, c, e) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 300) : "")); }
};

console.log("\n--- a call is recorded with the numbers the API reported ---");
const full = {
  input_tokens: 12000, output_tokens: 3400,
  cache_read_input_tokens: 9000, cache_creation_input_tokens: 500,
  server_tool_use: { web_search_requests: 6 },
};
const entry = await usage.recordUsage({ kind: "analyse", ref: "job1", model: "claude-opus-5", usage: full, ms: 4321 });
check("returns the entry it wrote", !!entry, entry);
check("input carried through", entry.input === 12000, entry);
check("output carried through", entry.output === 3400, entry);
check("cache read carried through", entry.cacheRead === 9000, entry);
check("cache write carried through", entry.cacheWrite === 500, entry);
check("search count read from server_tool_use", entry.searches === 6, entry);
check("timing rounded to the millisecond", entry.ms === 4321, entry);
check("kind and ref stored", entry.kind === "analyse" && entry.ref === "job1", entry);
check("model stored", entry.model === "claude-opus-5", entry);
check("stamped with a timestamp", typeof entry.at === "string" && entry.at.length > 0);

console.log("\n--- readUsage returns what was recorded, newest first ---");
await usage.recordUsage({ kind: "cover", ref: "job1", model: "claude-opus-5", usage: { input_tokens: 1, output_tokens: 1 }, ms: 1 });
const list = await usage.readUsage("job1");
check("both calls are there", list.length === 2, list.length);
check("newest first", list[0].kind === "cover", list.map((e) => e.kind));
check("a ref with nothing recorded reads empty", (await usage.readUsage("never-called")).length === 0);

console.log("\n--- a call with no usage object still records, at zero ---");
const empty = await usage.recordUsage({ kind: "answer", ref: "job2", model: "claude-sonnet-5" });
check("did not throw", !!empty, empty);
check("every number defaults to zero", empty.input === 0 && empty.output === 0 && empty.cacheRead === 0 && empty.cacheWrite === 0 && empty.searches === 0, empty);

console.log("\n--- two calls roll up into the same day ---");
const today = new Date().toISOString();
await usage.recordUsage({ kind: "analyse", ref: "roll1", model: "claude-opus-5", usage: { input_tokens: 100, output_tokens: 50 }, ms: 10 });
await usage.recordUsage({ kind: "cover", ref: "roll2", model: "claude-opus-5", usage: { input_tokens: 200, output_tokens: 75, cache_read_input_tokens: 30 }, ms: 20 });
const roll = await usage.dailyRollup(today);
check("call count summed", roll.calls >= 2, roll);
check("input summed across kinds", roll.input >= 300, roll);
check("output summed", roll.output >= 125, roll);
check("cache read summed", roll.cacheRead >= 30, roll);
check("date carries the ISO day, not the whole timestamp", /^\d{4}-\d{2}-\d{2}$/.test(roll.date), roll.date);

console.log("\n--- recentRollups covers every day in the window, even empty ones ---");
const days = await usage.recentRollups(7);
check("returns exactly the requested window", days.length === 7, days.length);
check("oldest first", days[0].date < days[6].date, days.map((d) => d.date));
check("today is the last entry", days[6].date === today.slice(0, 10), days[6].date);
check("a day with no calls is zero, not missing", days.every((d) => typeof d.calls === "number"), days);

console.log("\n--- a stats write never throws on a malformed usage value ---");
// A refusal or a tool error can hand back a usage object with fields missing
// or of the wrong shape. recordUsage must degrade to zeros rather than throw,
// because a stats write must never turn a good generation into a failed one.
let threw = false;
let weird;
try {
  weird = await usage.recordUsage({ kind: "analyse", ref: "job3", model: "x", usage: "not-an-object", ms: "not-a-number" });
} catch (err) {
  threw = true;
}
check("recordUsage never propagates an error", !threw);
check("it still returns a usable entry", !!weird, weird);

console.log("\n--- entries are capped so one job's history cannot grow without bound ---");
for (let i = 0; i < 60; i++) {
  await usage.recordUsage({ kind: "answer", ref: "capped", model: "x", usage: { input_tokens: i, output_tokens: 0 }, ms: 1 });
}
const capped = await usage.readUsage("capped");
check("list is capped at 50", capped.length === 50, capped.length);
check("the newest entries survive, not the oldest", capped[0].input === 59, capped[0]);

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
