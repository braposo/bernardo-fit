// Focused rendering regressions for the pipeline + selected-role workspace.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const html = fs.readFileSync(root + "public/admin.html", "utf8");
const componentUI = fs.readFileSync(root + "src/admin/ui.jsx", "utf8");
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const script = html.match(/<script(?:\s+type="module")?>([\s\S]*?)<\/script>/)[1];
let pass = 0, fail = 0;
const check = (name, condition, evidence) => {
  if (condition) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (evidence !== undefined ? "  -> " + JSON.stringify(evidence).slice(0, 220) : "")); }
};

function grab(name) {
  const start = script.indexOf("function " + name + "(");
  if (start === -1) return null;
  let depth = 0;
  for (let i = script.indexOf("{", start); i < script.length; i++) {
    if (script[i] === "{") depth++;
    else if (script[i] === "}" && --depth === 0) return script.slice(start, i + 1);
  }
  return null;
}

const needed = ["relativeTime", "timeHtml", "esc", "safeSourceUrl", "fmtDate", "fmtDateTime", "modelLabel", "countWords", "statsHtml", "staleHtml", "fmtChars",
  "tierClass", "assessmentStatusHtml", "stageLabel", "stageOptions", "materialRow", "runStateHtml", "versionRow", "versionsHtml", "questionsHtml", "jevAssessmentHtml", "jobHtml", "pipelineItemHtml"];
const missing = needed.filter((name) => !grab(name));
check("render helpers remain testable", missing.length === 0, missing);

const sandbox = [
  'var stages=["new","reviewing","applied","interviewing","offer","rejected","not_interested","expired"];',
  'var MODELS=[{id:"gpt-5.6-sol",label:"Sol"},{id:"claude-opus-5",label:"Opus"}];',
  'var workspaceSection="overview",selectedId="j1",showArchived=false,stageFilter=null,coverDispatchEnabled=true,screenDispatchEnabled=true,jevEnabled=true;',
  'var expandedVersions=new Set(); var location={origin:"https://fit.example"};',
  needed.map(grab).join("\n"),
  'return {jobHtml,pipelineItemHtml,questionsHtml,countWords,versionRow,setSection(v){workspaceSection=v},setFilter(v){stageFilter=v}};',
].join("\n");
let R;
try { R = new Function(sandbox)(); check("render helpers evaluate", true); }
catch (error) { check("render helpers evaluate", false, String(error)); console.log(`\npassed ${pass}, failed ${fail}`); process.exit(1); }

const base = {
  id: "j1", role: "Engineering Manager", company: "Sanity", stage: "interviewing", source: "LinkedIn",
  location: "London", locationMode: "Hybrid", salary: "£120k", jobDescription: "A".repeat(300), notes: "private",
  instructions: "Emphasise platform work", questions: [], archived: false, score: 70, tier: "Worth a look",
  scoreBreakdown: { location: 2, aiDx: 3, leadership: 4 }, fitReportId: "fit1", hasDescription: true,
  hasCoverLetter: true, coverLetterAt: "2026-09-01T00:00:00Z", hasResearch: true, researchId: "r1",
  researchSourceCount: 8, hasBrief: true, briefId: "b1", stats: { view: 2, copy_link: 1, cv_download: 0 },
};
const render = (section, over = {}) => { R.setSection(section); return R.jobHtml({ ...base, ...over }); };
const actions = (markup) => [...markup.matchAll(/data-act="([^"]+)"/g)].map((match) => match[1]);

console.log("\n--- compact pipeline ---");
const mixedRow = R.pipelineItemHtml(base);
check("row contains company and role", /Sanity/.test(mixedRow) && /Engineering Manager/.test(mixedRow));
check("mixed-stage row shows stage", /Interviewing/.test(mixedRow));
R.setFilter("interviewing");
check("stage remains visible when filtered", /Interviewing/.test(R.pipelineItemHtml(base)));
check("row has no editors or generation toolbar", !/textarea|data-act="cover"|data-act="regen"/.test(mixedRow));

console.log("\n--- overview ---");
const overview = render("overview");
check("unassessed overview has five empty gauge mounts", (overview.match(/data-score-gauge=/g) || []).length === 5 && (overview.match(/data-value=""/g) || []).length === 5);
check("document shortcuts stay out of Overview", !actions(overview).some(a => ["briefopen","letteropen","copyfit"].includes(a)) && !overview.includes("Ready to use"));
check("overview offers the standalone Jev assessment", /class="generation" data-act="jevscore"/.test(overview));
const jev = render("overview", { score: null, jevStale: true, jevAssessment: { assessedAt: "2026-09-19T12:00:00Z", score: null,
  dimensions: ["Responsibilities", "Evidence", "Scope", "Direction", "Practical"].map(label => ({ label, score: 75, weight: 20, confidence: null })),
  posting: { choice: "partial" }, constraint: { choice: "unknown" } } });
check("Jev shows five gauges and stale assessments withhold values", (jev.match(/data-score-gauge=/g) || []).length === 5 && (jev.match(/data-value=""/g) || []).length === 5);
check("stale assessment is concise", jev.includes("Outdated") && !jev.includes("Partial description") && !jev.includes("Previous analysis score"));
const provisional = render("overview", { score: 70, jevAssessment: { assessedAt: "2026-09-20T12:00:00Z", score: 70, provisional: true,
  dimensions: [{ label: "Practical", score: 50, weight: 10, confidence: 0.4, evidenceLimited: true, evidenceNote: "Travel needs clarification <details>" }],
  posting: { choice: "partial" }, constraint: { choice: "unknown" } } });
check("provisional ratings retain confidence and header status without repeated prose", provisional.includes('data-value="50"') && provisional.includes("Provisional score") && provisional.includes("Model confidence: 40%") && !provisional.includes("Travel needs clarification"));
check("provisional pipeline score is labelled", R.pipelineItemHtml({ ...base, jevAssessment: { provisional: true } }).includes('Provisional score'));
check("stale warning takes precedence", R.pipelineItemHtml({ ...base, jevStale: true, jevAssessment: { provisional: true } }).includes('Needs reassessment'));
check("constraint conflict is visible in pipeline", R.pipelineItemHtml({ ...base, jevAssessment: { blocked: true, provisional: true } }).includes('Constraint conflict'));
check("sparse descriptions can be assessed", !/data-act="jevscore" disabled/.test(render("overview", { jobDescription: "", hasDescription: false })));
check("TypeSafe replaces obsolete Gateway copy", !render("overview", { jevRun: { status: "failed" } }).includes('Gateway'));
check("engagement and activity shortcut are absent from Overview", !/class="stats"|data-section-link="activity"/.test(overview));

const withSummary = render("overview", { jevAssessment: { dimensions: [], assessedAt: "2026-09-21" }, overviewSummary: { assessedAt: "2026-09-21", position: "Lead a team <script>unsafe()</script>", fit: "Strong leadership fit." } });
check("summary renders escaped role and score interpretation", withSummary.includes("Lead a team &lt;script&gt;") && withSummary.includes("Strong leadership fit."));
check("overview uses model-neutral action copy", overview.includes('>Assess fit</button>') && !overview.includes('with Jev') && !overview.includes('Uses AI credits'));
check("stale summary is withheld", !render("overview", { jevStale: true, overviewSummary: { position: "Old summary", fit: "Old fit" } }).includes("Old summary"));
check("a refreshed assessment cannot display cached prose from another assessment", !render("overview", { jevAssessment: { dimensions: [], assessedAt: "2026-09-22" }, overviewSummary: { assessedAt: "2026-09-21", position: "Old summary", fit: "Old fit" } }).includes("Old summary"));
console.log("\n--- materials ---");
const materials = render("materials", { briefStale: true, researchStale: true });
for (const label of ["Open fit page", "Open letter", "Open previous brief", "Open research"]) check(label + " is present", materials.includes(label));
for (const label of ["Generate new version"]) check(label + " is a sparkle action", new RegExp('class="generation"[^>]*>' + label).test(materials), materials.match(new RegExp('.{0,80}' + label)));
check("stale brief remains openable", actions(materials).includes("briefopen"));
check("visible cost legend is removed", !materials.includes("Sparkle actions"));
check("no repeated Paid AI labels", !/Paid AI/.test(materials));

console.log("\n--- questions ---");
const questionMarkup = render("materials", { questions: [{ id: "q1", q: "Why here?", limit: 120, a: "one two three" }] });
for (const action of ["qtext", "qlimit", "qdraft", "qcopy", "qdel", "qadd"]) check("question has " + action, actions(questionMarkup).includes(action));
check("drafting is a generation action", /class="generation" data-act="qdraft"/.test(questionMarkup));
check("word count is correct", R.countWords("systems and services") === 3);

console.log("\n--- role context and activity ---");
const context = render("context");
for (const field of ["company", "role", "location", "salary", "sourceUrl", "jobDescription", "notes", "instructions"]) check("context labels " + field, context.includes('data-field="' + field + '"'));
check("notes disclose AI use", /notes may be used as context/i.test(context));
const activity = render("activity");
check("versions live within document cards", !/Output versions/.test(activity) && (materials.match(/data-act="document-versions"/g)||[]).length === 4);
check("record management is separate", /Record management/.test(activity));
const version = R.versionRow({ vid: "v1", at: "2026-09-01", model: "gpt-5.6-sol", active: false }, "fit");
check("version preview and activation are distinct", /verpreview/.test(version) && /veruse/.test(version));

console.log("\n--- navigation, review and responsive contract ---");
check("one stage dropdown replaces stage chips", /id="stagefilter"/.test(script) && !/class="stagechip/.test(script));
check("model moved into generation review", /data-review-model/.test(script) && !/id="modelsel"/.test(script));
check("opening review uses the read-only action", /action:\s*'review'/.test(script));
check("submit carries reviewed fingerprint", /reviewFingerprint\s*=\s*currentReview\.fingerprint/.test(script));
check("cancel only closes the dialog", /data-review-cancel[\s\S]*addEventListener\('click', close\)/.test(script));
check("review delegates focus and Escape to shadcn Dialog", /createAdminDialog\(/.test(script) && /<Dialog open onOpenChange/.test(componentUI) && /onCloseAutoFocus/.test(componentUI));
check("URL state includes collection, stage, search, job and section", ["collection", "stage", "q", "job", "section"].every((key) => script.includes('p.set("' + key + '"')));
check("search replaces history", /searchQuery = searchEl\.value;\s*writeNavigation\("replace"\)/.test(script));
check("mobile collapses to one pane near 900px", /@media \(max-width: 900px\)/.test(style) && /\.admin-shell\.has-selection \.pipeline \{ display: none/.test(style));
check("mobile actions do not scroll horizontally", !/material-actions[^}]*overflow-x/.test(style));
check("generation uses amber tokens", style.includes("--generation: #fff0d4") && /\.generation \{/.test(style));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
