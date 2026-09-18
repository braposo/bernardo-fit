// Build a local, self-contained comparison using the fit page's own typography.
// Inputs and output stay in ignored .vercel/fit-comparison; no production writes.
// node scripts/build-fit-comparison.mjs [.vercel/sanity-comparison]
import fs from "node:fs";
import path from "node:path";
import { publicReport } from "../lib/report.js";

const directory = path.resolve(process.argv[2] || ".vercel/fit-comparison");
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
const input = read("input.json");
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const definitions = [
  { key: "opus", label: "Claude Opus 5", model: "claude-opus-5", file: "opus-existing.json", provenance: "Existing published analysis" },
  { key: "sol", label: "GPT-5.6 Sol", model: "gpt-5.6-sol", file: "sol.json", provenance: "New Codex agent sample" },
  { key: "astra", label: "GPT-6 Astra", model: "gpt-6-astra", file: "astra.json", provenance: "New Codex agent sample" },
];
if (fs.existsSync(path.join(directory, "luna.json"))) {
  definitions.push({ key: "luna", label: "GPT-5.6 Luna", model: "gpt-5.6-luna", file: "luna.json", provenance: "New Codex agent sample" });
}
const reports = definitions.map(item => ({ ...item, report: publicReport(read(item.file)) }));
const sampleNames = reports.slice(1).map(r => r.key[0].toUpperCase() + r.key.slice(1)).join(", ");
const company = reports[0].report.company;
const role = reports[0].report.job_title;
const notesPath = path.join(directory, "notes.json");
const notes = fs.existsSync(notesPath) ? read("notes.json") : [];
const words = text => String(text || "").trim().split(/\s+/).filter(Boolean).length;
function fields(r) {
  return [r.pitch, ...r.categories.map(c => c.note), ...r.differentiators.flatMap(d => [d.headline, d.detail]), r.closing];
}
function violations(r) {
  return [words(r.pitch) > 55, ...r.categories.map(c => words(c.note) > 45),
    ...r.differentiators.map(d => words(d.detail) > 30), words(r.closing) > 30].filter(Boolean).length;
}
const fitHtml = fs.readFileSync("public/index.html", "utf8");
const style = fitHtml.match(/<style>([\s\S]*?)<\/style>/)[1];
const fonts = fitHtml.match(/<link href="https:\/\/fonts.googleapis.com[^>]+>/)[0];
function body(r) {
  return `<div class="pitch-block"><p class="pitch">${esc(r.pitch)}</p></div>
    <div class="cats">${r.categories.map(c => `<div class="cat"><div class="cat-name">${esc(c.name)}</div><div class="cat-note">${esc(c.note)}</div></div>`).join("")}</div>
    <div class="section-label">What sets me apart</div>
    <div class="diffs">${r.differentiators.map((d, i) => `<div class="diff"><div class="diff-idx">${String(i + 1).padStart(2, "0")}</div><div class="diff-headline">${esc(d.headline)}</div><div class="diff-detail">${esc(d.detail)}</div></div>`).join("")}</div>
    <div class="closing-wrap"><p class="closing">${esc(r.closing)}</p><div class="sign">— Bernardo<small>Available now · Remote-first · Harrogate, UK</small></div></div>`;
}
const output = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(company)} · Fit analysis model comparison</title>${fonts}<style>${style}
  .frame { --maxw: 1280px; --pad: clamp(20px, 4vw, 60px); }
  .intro { max-width: 76ch; color: var(--body2); line-height: 1.65; }
  .controls { display:flex; flex-wrap:wrap; gap:8px; padding:18px 0; margin-top:28px; border-block:1px solid var(--hair); position:sticky; top:0; z-index:2; background:var(--paper); }
  .controls button { font:inherit; font-size:14px; border:1px solid var(--hair-strong); border-radius:99px; padding:10px 18px; cursor:pointer; background:transparent; color:var(--ink); }
  .controls button[aria-pressed="true"] { background:var(--ink); color:var(--paper); }
  .meta { color:var(--sub); font:12px/1.6 var(--mono); }
  article h2 { font-family:var(--display); margin:30px 0 4px; }
  .compare article { padding-bottom: 40px; }
  .compare.all { display:grid; grid-template-columns:repeat(${reports.length > 3 ? 2 : 3},minmax(0,1fr)); gap:32px; }
  .all .cat { grid-template-columns:1fr; gap:10px; }
  .all .pitch { font-size:22px; }
  .all .diff { grid-template-columns:1fr; gap:8px; }
  .all .diff-idx { grid-row:auto; font-size:26px; }
  .all .closing { font-size:23px; }
  .all .diff-headline { font-size:21px; }
  .metrics { overflow-x:auto; margin:24px 0; }
  table { border-collapse:collapse; width:100%; text-align:left; font-size:14px; }
  th,td { padding:12px 14px 12px 0; border-bottom:1px solid var(--hair); }
  details { margin:24px 0; color:var(--body2); line-height:1.65; }
  summary { cursor:pointer; }
  pre { white-space:pre-wrap; font:14px/1.65 var(--sans); }
  [hidden] { display:none !important; }
  .takeaways { border-left:2px solid var(--accent); padding-left:18px; margin:24px 0; }
  .takeaways p { line-height:1.6; color:var(--body2); max-width:78ch; }
  .role-title { overflow-wrap:anywhere; }
  @media(max-width:850px) { .compare.all { grid-template-columns:1fr; } .compare.all article + article { border-top:2px solid var(--hair-strong); } }
  @media(max-width:560px) { .controls { display:grid; grid-template-columns:repeat(${reports.length + 1},minmax(0,1fr)); gap:6px; padding:12px 0; } .controls button { padding:11px 4px; font-size:13px; } th,td { padding-right:8px; font-size:12px; } .to-line { margin-top:24px; } }
</style></head><body><main class="frame">
  <div class="masthead"><div class="mark">Bernardo Raposo<span class="dot">.</span></div><span class="kicker">Model comparison</span></div>
  <div class="to-line">On fit for</div><h1 class="role-title">${esc(role)} <span class="company">at ${esc(company)}</span></h1>
  <p class="intro">One role, ${reports.length} model samples. Compare the existing Opus fit page with ${esc(sampleNames)}, then switch models to read each in the fit page layout.</p>
  <details><summary>About this comparison</summary><p class="intro meta">Opus is the published baseline. ${esc(sampleNames)} receive the same saved app prompt, profile and job description in separate Codex agents. Codex adds its own agent instructions, and the original Opus prompt has not been verified byte for byte. This is a writing comparison, not a controlled API benchmark. Outputs are shown without editorial changes. API costs and generation speed have not been measured here.</p></details>
  <p><a href="${esc(input.sourceUrl)}" target="_blank" rel="noopener">Open original ${esc(company)} fit page ↗</a></p>
  ${notes.length ? `<section class="takeaways" aria-label="What changes in this sample"><h2>What changes</h2>${notes.map(n => `<p><strong>${esc(n.label)}.</strong> ${esc(n.text)}</p>`).join("")}<p class="meta">Editorial observations about these samples only.</p></section>` : ""}
  <div class="metrics"><table><caption class="meta">Mechanical checks · public prose only · whitespace word counts</caption><thead><tr><th scope="col">Sample</th><th scope="col">Words</th><th scope="col">Pitch / 55</th><th scope="col">Fields over budget</th></tr></thead><tbody>${reports.map(({ label, report:r }) => `<tr><th scope="row">${esc(label)}</th><td>${fields(r).reduce((n,f) => n + words(f), 0)}</td><td>${words(r.pitch)}</td><td>${violations(r)}</td></tr>`).join("")}</tbody></table></div>
  <nav class="controls" aria-label="Choose comparison view"><button type="button" data-view="all" aria-pressed="true">All</button>${reports.map(r => `<button type="button" data-view="${r.key}" aria-label="${esc(r.label)}" aria-pressed="false">${esc(r.key[0].toUpperCase() + r.key.slice(1))}</button>`).join("")}</nav>
  <div class="compare all" id="comparison">${reports.map(r => `<article data-model="${r.key}" aria-label="${esc(r.label)} analysis"><h2>${esc(r.label)}</h2><div class="meta">${esc(r.provenance)}<br>${esc(r.model)}</div>${body(r.report)}</article>`).join("")}</div>
  <details><summary>Job description used for the comparison</summary><pre>${esc(input.jobDescription)}</pre></details>
  <div class="footer">Example · generated ${new Date().toISOString().slice(0,10)} · private triage scores excluded</div>
</main><script>
  const container = document.getElementById('comparison');
  const buttons = [...document.querySelectorAll('[data-view]')];
  function select(view) {
    if (!buttons.some(button => button.dataset.view === view)) view = window.matchMedia('(max-width:850px)').matches ? 'opus' : 'all';
    container.classList.toggle('all', view === 'all');
    container.querySelectorAll('article').forEach(article => { article.hidden = view !== 'all' && article.dataset.model !== view; });
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  }
  buttons.forEach(button => button.addEventListener('click', () => { location.hash = button.dataset.view; select(button.dataset.view); }));
  window.addEventListener('hashchange', () => select(location.hash.slice(1)));
  select(location.hash.slice(1));
</script></body></html>`;
fs.writeFileSync(path.join(directory, "index.html"), output);
console.log("Created " + path.join(directory, "index.html"));
