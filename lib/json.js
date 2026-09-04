// A model asked for JSON does not always send back exactly JSON: a markdown
// fence, a trailing comma, an unescaped quote inside a string value. This is
// the tolerant parse both generators that ask for JSON output share, so the
// repair logic exists in one place rather than drifting between two copies —
// which is exactly what had happened before this file existed.

// Strips a markdown fence and any prose either side of the object, then tries
// the raw text and three repaired variants in order, validating each with the
// caller's own shape check. `validate` defaults to "parsed at all", since
// api/analyze.js's response has no shape narrower than "is an object" to check.
export function parseLooseJson(raw, validate) {
  const isValid = validate || ((v) => v && typeof v === "object");

  let s = String(raw || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  s = s.slice(first, last + 1);

  const attempts = [
    s,
    s.replace(/,\s*([}\]])/g, "$1"),           // trailing commas
    repairInnerQuotes(s),                      // unescaped quotes inside values
    repairInnerQuotes(s).replace(/,\s*([}\]])/g, "$1"),
  ];

  for (const candidate of attempts) {
    try {
      const obj = JSON.parse(candidate);
      if (isValid(obj)) return obj;
    } catch {
      /* try the next repair */
    }
  }
  return null;
}

// Escapes double quotes that sit inside a JSON string value. Walks the text
// tracking whether we are inside a string, and escapes any quote that is not
// followed by a structural character.
export function repairInnerQuotes(s) {
  let out = "";
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") { out += c + (s[i + 1] || ""); i++; continue; }
    if (c === '"') {
      if (!inString) { inString = true; out += c; continue; }
      // Closing quote only if the next non-space character is structural.
      const rest = s.slice(i + 1);
      const next = (rest.match(/^\s*(.)/) || [])[1];
      if (next === ":" || next === "," || next === "}" || next === "]" || next === undefined) {
        inString = false;
        out += c;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += c;
  }
  return out;
}
