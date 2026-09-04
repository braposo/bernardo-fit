// Guards the shared tolerant JSON parser, lifted out of the cover letter's
// own parser so the fit analysis stops carrying a second, weaker copy of the
// same repair logic. Both generators call this now; test-coverparse.mjs and
// test-analyse.mjs cover them using it, this file covers the parser itself.

import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const lib = "file:///" + root + "lib/";
const { parseLooseJson, repairInnerQuotes } = await import(lib + "json.js");

let pass = 0, fail = 0;
const check = (n, c, e) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 200) : "")); }
};

console.log("\n--- plain JSON needs no repair ---");
check("a clean object parses", parseLooseJson('{"a": 1}').a === 1);
check("a fenced object parses", parseLooseJson('```json\n{"a": 1}\n```').a === 1);
check("prose either side is stripped", parseLooseJson('Here you go:\n{"a": 1}\nThat is it.').a === 1);

console.log("\n--- the repair passes ---");
check("a trailing comma is tolerated", parseLooseJson('{"a": 1, "b": 2,}').b === 2);
check("an unescaped inner quote is repaired", parseLooseJson('{"a": "he said "hi" to me"}').a === 'he said "hi" to me');
check("both faults together", parseLooseJson('{"a": "say "hi"", "b": 2,}').b === 2);

console.log("\n--- unparseable input fails honestly ---");
check("no object at all", parseLooseJson("just some prose") === null);
check("empty string", parseLooseJson("") === null);
check("nothing", parseLooseJson(null) === null);
check("truncated mid-object", parseLooseJson('{"a": "unterminated') === null);

console.log("\n--- validate narrows what counts as success ---");
const hasName = (obj) => obj && typeof obj.name === "string";
check("a shape that matches the validator passes", parseLooseJson('{"name": "x"}', hasName).name === "x");
check("a shape that does not match is rejected", parseLooseJson('{"other": "x"}', hasName) === null);
// The two faults compound in practice: a value needing quote repair sitting
// inside an object the caller still has to recognise as the right shape.
check(
  "the shape check applies after repair, not just to the raw input",
  parseLooseJson('{"name": "he said "hi""}', hasName).name === 'he said "hi"'
);

console.log("\n--- no validator means any parsed object counts ---");
check("an object with no expected shape still passes", parseLooseJson('{"whatever": true}').whatever === true);

console.log("\n--- repairInnerQuotes on its own ---");
check("closes on a structural follow character", repairInnerQuotes('"he said "hi" to me"') === '"he said \\"hi\\" to me"');
check("leaves an already-escaped quote alone", repairInnerQuotes('"a \\"clean\\" string"') === '"a \\"clean\\" string"');
check("a backslash is copied with whatever follows it", repairInnerQuotes("a\\nb") === "a\\nb");

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
