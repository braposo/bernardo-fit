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
  "tierClass", "assessmentStatusHtml", "stageLabel", "stageOptions", "materialRow", "applicationMaterialRow", "runStateHtml", "versionRow", "versionsHtml", "questionsHtml", "timelineHtml", "timelineDateText", "interviewLine", "proposalMoveHtml", "proposalBodyHtml", "emailProposalsHtml", "ratingConfidence", "jevAssessmentHtml", "jobHtml", "pipelineItemHtml",
  "journeyKey", "journeyDay", "journeyBadge", "journeyBodyHtml", "journeyHtml", "insightsKpi", "stageBadge"];
const missing = needed.filter((name) => !grab(name));
check("render helpers remain testable", missing.length === 0, missing);

const sandbox = [
  'var stages=["new","reviewing","applied","interviewing","offer","rejected","not_interested","expired"];',
  'var MODELS=[{id:"gpt-5.6-sol",label:"Sol"},{id:"claude-opus-5",label:"Opus"}];',
  'var workspaceSection="overview",selectedId="j1",showArchived=false,stageFilter=null,coverDispatchEnabled=true,screenDispatchEnabled=true,jevEnabled=true;',
  'var emailProposals=[], tlDrafts={}; var TIMELINE_KIND_LABELS={phone:\"Phone\",video:\"Video\",onsite:\"On-site\",assessment:\"Assessment\",other:\"Other\"}; var expandedVersions=new Set(); var location={origin:"https://fit.example"};',
  'var journeyCache={}; var stageName=s=>({new:"New",reviewing:"Reviewing",applied:"Applied",interviewing:"Interviewing",rejected:"Rejected"})[s]||s; var daysText=v=>v==null?"—":v+" days";',
  ...[/var JOURNEY_COLORS = [^\n]*;/].map(pattern => script.match(pattern)?.[0] || ''),
  needed.map(grab).join("\n"),
  'return {journeyCache,journeyBodyHtml,timelineHtml,proposalBodyHtml,setEmailProposals(v){emailProposals=v},jobHtml,pipelineItemHtml,questionsHtml,countWords,versionRow,setSection(v){workspaceSection=v},setFilter(v){stageFilter=v}};',
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
  applicationCv: { currentVersionId: "cv2", status: "ready", downloadUrl: "/fit/example/cv.pdf" },
  researchSourceCount: 8, hasBrief: true, briefId: "b1", stats: { view: 2, copy_link: 1, cv_download: 0 },
};
const render = (section, over = {}) => { R.setSection(section); return R.jobHtml({ ...base, ...over }); };
const actions = (markup) => [...markup.matchAll(/data-act="([^"]+)"/g)].map((match) => match[1]);

console.log("\n--- stage timeline ---");
const journeyLoading = render("overview");
check("overview has a timeline section after the summary", journeyLoading.indexOf("Timeline</h2>") > journeyLoading.indexOf("Summary</h2>") && /data-job-journey="j1"/.test(journeyLoading));
check("timeline loads until its data arrives", /Loading timeline/.test(journeyLoading));
const journeyData = { addedAt: "2026-10-01T00:00:00Z", source: "LinkedIn", complete: true, historyFrom: null, open: true, totalDays: 20, appliedAt: "2026-10-09T00:00:00Z", appliedTimes: 1, daysToApply: 8,
  stages: [{ stage: "new", from: "2026-10-01T00:00:00Z", to: "2026-10-03T00:00:00Z", days: 2 }, { stage: "reviewing", from: "2026-10-03T00:00:00Z", to: "2026-10-09T00:00:00Z", days: 6, byAgent: true },
    { stage: "applied", from: "2026-10-09T00:00:00Z", to: "2026-10-15T00:00:00Z", days: 6 }, { stage: "interviewing", from: "2026-10-15T00:00:00Z", to: null, days: 6, current: true }] };
R.journeyCache.j1 = { key: "j1:interviewing:false", data: journeyData };
const journey = render("overview");
check("cached timeline renders without loading", !/Loading timeline/.test(journey) && /journey-list/.test(journey));
check("timeline shows a row per stage", (journey.match(/journey-item/g) || []).length === 4);
check("current stage reads so far", /6 days so far/.test(journey) && /journey-item is-current/.test(journey));
check("agent move is badged", /Moved by agent/.test(journey));
check("applied tile says how soon", /8 days after it was added/.test(journey));
const legacyJourney = R.journeyBodyHtml({ ...journeyData, complete: false, historyFrom: "2026-10-05T00:00:00Z", stages: [{ stage: "reviewing", from: null, to: "2026-10-09T00:00:00Z", days: null }, journeyData.stages[3]] });
check("legacy timeline has no bar and says when recording began", !/journey-bar/.test(legacyJourney) && /Stage changes are recorded from/.test(legacyJourney) && /Until /.test(legacyJourney));
R.journeyCache.j1 = null;

console.log("\n--- compact pipeline ---");
const mixedRow = R.pipelineItemHtml(base);
check("row contains company and role", /Sanity/.test(mixedRow) && /Engineering Manager/.test(mixedRow));
check("mixed-stage row shows stage", /Interviewing/.test(mixedRow));
R.setFilter("interviewing");
check("stage remains visible when filtered", /Interviewing/.test(R.pipelineItemHtml(base)));
check("row has no editors or generation toolbar", !/textarea|data-act="cover"|data-act="regen"/.test(mixedRow));

console.log("\n--- overview ---");
const overview = render("overview");
const proposal = { id: "p1", jobId: "j1", company: "Sanity", role: "Engineering Manager", stage: "applied", proposedStage: "interviewing",
  summary: "Invited to a final round.", interview: { date: "2026-11-03", round: "Final round", kind: "video" }, createdAt: "2026-10-28T08:45:00Z",
  email: { subject: "Final round", from: "talent@sanity.example", date: "2026-10-28T08:30:00Z", link: "https://mail.google.com/mail/u/0/#all/t1" } };
R.setEmailProposals([proposal, { ...proposal, id: "p2", jobId: "other" }]);
const withProposal = render("overview", { stage: "applied" });
check("Overview leads with the role's own email update, with Apply and Dismiss",
  (withProposal.match(/data-proposal-id=/g) || []).length === 1 && withProposal.indexOf("Email update") < withProposal.indexOf("data-score-gauge") &&
    /data-px-act="apply" data-px-id="p1"/.test(withProposal) && /data-px-act="dismiss" data-px-id="p1"/.test(withProposal) && /Final round · Video/.test(withProposal));
check("an email that keeps the stage offers to add to the timeline", /Add to timeline/.test(R.proposalBodyHtml({ ...proposal, proposedStage: "applied" })));
R.setEmailProposals([]);
check("no review agent card, question or lean badge remains", !/data-agent-review|data-agent-decide|Agent: unsure|Question for you/.test(render("overview", { stage: "new", agentReview: { lean: "ask", question: "Q?" } }) + R.pipelineItemHtml({ ...base, stage: "new", agentReview: { lean: "ask" } })));
check("unassessed overview has five empty gauge mounts", (overview.match(/data-score-gauge=/g) || []).length === 5 && (overview.match(/data-value=""/g) || []).length === 5);
check("document shortcuts stay out of Overview", !actions(overview).some(a => ["briefopen","letteropen","copyfit"].includes(a)) && !overview.includes("Ready to use"));
check("overview offers the standalone Jev assessment", /class="generation" data-act="jevscore"/.test(overview));
const jev = render("overview", { score: 70, jevStale: true, jevAssessment: { assessedAt: "2026-09-19T12:00:00Z", score: 70,
  dimensions: ["Responsibilities", "Evidence", "Scope", "Direction", "Practical"].map(label => ({ label, score: 75, weight: 20, confidence: null })),
  posting: { choice: "partial" }, constraint: { choice: "unknown" } } });
check("outdated assessments retain their five saved dimension scores", (jev.match(/data-score-gauge=/g) || []).length === 5 && (jev.match(/data-value="75"/g) || []).length === 5);
check("outdated scores remain labelled in the role and pipeline", render("overview", { score: 70, jevStale: true }).includes('aria-label="70 out of 100 fit score, from an outdated assessment"') && R.pipelineItemHtml({ ...base, jevStale: true }).includes('aria-label="70 out of 100 fit score, from an outdated assessment"'));
check("stale assessment is concise", jev.includes("Outdated") && !jev.includes("Partial description") && !jev.includes("Previous analysis score"));
const provisional = render("overview", { score: 70, jevAssessment: { assessedAt: "2026-09-20T12:00:00Z", score: 70, provisional: true,
  dimensions: [{ label: "Practical", score: 50, weight: 10, confidence: 0.4, evidenceLimited: true, evidenceNote: "Travel needs clarification <details>" }],
  posting: { choice: "partial" }, constraint: { choice: "unknown" } } });
check("posting issues remain visible without reviving obsolete evidence warnings", provisional.includes('data-value="50"') && provisional.includes("Review the job description") && provisional.includes("The job description has too little detail") && !provisional.includes("Travel needs clarification") && provisional.includes("Model confidence: 40%"));
check("low confidence is shown without a review flag", !provisional.includes('assessment-confidence-warning') && !provisional.includes('Review rating'));
{
  // Paddle, 20 Nov: probabilities split across neighbouring levels.
  const split = render("overview", { jevAssessment: { dimensions: [
    { label: "Responsibilities", score: 56, weight: 30, confidence: 0.59, probabilities: { 0: 0, 1: 0.01, 2: 0.41, 3: 0.52, 4: 0.06 } },
    { label: "Practical", score: 69, weight: 20, confidence: 0.5, probabilities: { 0: 0, 1: 0.01, 2: 0.22, 3: 0.41, 4: 0.36 } },
    { label: "Spread", score: 50, weight: 10, confidence: 0.4, probabilities: { 0: 0.2, 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2 } }],
    posting: { choice: "complete" } } });
  check("confidence counts the two closest neighbouring levels", split.includes("Model confidence: 93%") && split.includes("Model confidence: 77%") && split.includes("Model confidence: 40%"));
}
for (const confidence of [0, 0.59, 0.69, 0.7, 0.9, null]) {
  const current = render("overview", { jevAssessment: { dimensions: [{label:"Practical",score:76,weight:10,confidence}], posting:{choice:"complete"} } });
  check("confidence cue at " + confidence + " preserves the score and avoids missing-data claims", current.includes('data-value="76"') &&
    !current.includes('Review rating') &&
    !current.includes('Review the job description') && !current.includes('need clarification'));
}
check("outdated assessments show Outdated instead of confidence", !jev.includes('Model confidence'));
check("provisional pipeline score uses an accessible warning icon", R.pipelineItemHtml({ ...base, jevAssessment: { provisional: true } }).includes('aria-label="Provisional score; see Fit assessment for details"') && R.pipelineItemHtml({ ...base, jevAssessment: { provisional: true } }).includes('>⚠</span>'));
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
for (const label of ["Open fit page", "Open letter", "Open CV", "Download CV", "Open previous brief", "Open research"]) check(label + " is present", materials.includes(label));
check("CV and cover letter remain separate", !materials.includes("Open CV + letter") && !/combined=1/.test(html));
check("cover-letter generation remains explicit", /data-act="cover"/.test(materials));
check("saved documents use outline regeneration actions", [...materials.matchAll(/class="generation generation-outline" data-act="(appgenerate|cover|briefrewrite|researchrefresh)"/g)].length === 4);
const fresh = render("materials", { fitReportId: "", applicationCv: null, hasCoverLetter: false, hasBrief: false, hasResearch: false });
check("first-generation actions retain their filled style", /class="generation" data-act="appgenerate"/.test(fresh));
check("fit analysis and CV are generated together", fresh.includes(">Generate fit page &amp; CV<") && !/data-act="(runfit|regen|cvgenerate)"/.test(fresh));
check("an old review state is not shown as a gate", !/review/i.test(render("materials", { applicationCv: { currentVersionId: "cv2", status: "needs_review", validationStatus: "needs_review", downloadUrl: "/fit/example/cv.pdf" } }).match(/data-document="cv"[\s\S]*?<\/section>/)[0]));
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
const version = R.versionRow({ vid: "v1", at: "2026-09-01", model: "gpt-5.6-sol", active: false, score: 88 }, "fit");
check("version history ignores historical scores", !version.includes("score 88"));
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


console.log("\n--- application questions and interview timeline sections ---");
const reviewing = render("materials", { stage: "reviewing", postingCheck: { status: "checked", gaps: [], form: { questions: [{ id: "q1", text: "Why us?", state: "drafted" }] } } });
check("Documents keeps manual application questions and has no automatic checklist", /Add a question/.test(reviewing) && !/Application checklist|data-pc-/.test(reviewing));
const timeline = [{ id: "t1", date: "2026-11-03", round: "Final round", kind: "video", source: "email", notes: "Prep", proposalId: "p1" }];
const interviewing = render("overview", { stage: "interviewing", interviewTimeline: timeline });
check("Overview shows the interview timeline with source badge and notes", /Interview timeline/.test(interviewing) && /Final round/.test(interviewing) && />Email</.test(interviewing) && /data-tl-notes/.test(interviewing) && /data-tl-act="add"/.test(interviewing) && /data-tl-act="remove"/.test(interviewing));
check("the timeline is hidden for early roles with no entries", !/Interview timeline/.test(render("overview", { stage: "reviewing", interviewTimeline: [] })));
check("timeline text is escaped", !/<script>/.test(render("overview", { stage: "interviewing", interviewTimeline: [{ ...timeline[0], round: "<script>x</script>" }] })));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
