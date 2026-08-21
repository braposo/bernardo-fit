process.env.ADMIN_SECRET = "test-secret-value";
process.env.ANTHROPIC_API_KEY = "sk-fake";
// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";

import fs from "node:fs";

let prompts = [];
let reply = "A perfectly ordinary answer of a few words.";
globalThis.fetch = async (_u, opts) => {
  prompts.push(JSON.parse(opts.body).system);
  return { ok: true, json: async () => ({ content: [{ type: "text", text: reply }], stop_reason: "end_turn" }) };
};

const store = await import(base + "_store.js");
const ans = await import(base + "_answer.js");
const answer = (await import(base + "admin/answer.js")).default;
const reportHandler = (await import(base + "report.js")).default;

let pass = 0, fail = 0;
const check = (n, c, e) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (e !== undefined ? "  -> " + JSON.stringify(e).slice(0, 200) : "")); }
};
function mockRes() {
  const r = { statusCode: 0, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r; r.setHeader = () => r;
  return r;
}
const auth = { "x-admin-secret": "test-secret-value", host: "fit.bernardoraposo.com" };
const post = async (body) => { const r = mockRes(); await answer({ method: "POST", headers: auth, body }, r); return r; };

console.log("\n--- limits ---");
check("default is 120", ans.DEFAULT_LIMIT === 120);
check("clamps low", ans.clampLimit(1) === 20);
check("clamps high", ans.clampLimit(100000) === 500);
check("rubbish falls back", ans.clampLimit("abc") === 120);
const clamped = await store.saveJob({ company: "C", role: "R", questions: [{ q: "x", limit: 9999 }] });
check("stored limit is clamped", clamped.questions[0].limit === 500);
check("every question gets an id", !!clamped.questions[0].id);

console.log("\n--- the prompt ---");
const p = ans.buildAnswerPrompt({ question: "Why us?", limit: 90, jobDescription: "A platform role" });
check("budget is hoisted to the top", p.indexOf("90 words MAXIMUM") < p.indexOf("## Writing rules"));
check("shares the anti-slop rules", p.includes("Never count my own experience"));
check("splits factual from prose", p.includes("Two kinds of question, two kinds of answer"));
check("guards invented facts", p.includes("Never invent a fact"));
check("names salary as the trap", p.includes("salary expectations"));
check("bans throat-clearing", p.includes("No throat-clearing"));
check("no prior block when nothing is prior", !p.includes("What I have already said"));
check("no unresolved templates", !p.includes("${"));

console.log("\n--- answering a question ---");
const job = await store.saveJob({
  company: "Acme",
  role: "Head of Eng",
  jobDescription: "A long enough job description for a leadership role.",
  questions: [{ q: "Why do you want to work here?", limit: 80 }],
});
const qid = job.questions[0].id;
prompts = [];
let res = await post({ id: job.id, questionId: qid });
check("answered", res.statusCode === 200, res.body);
check("saved on the row", (await store.getJob(job.id)).questions[0].a === reply);
check("word count returned", res.body.words === ans.countWords(reply), res.body.words);
check("not flagged over", res.body.over === false);
check("timestamped", !!(await store.getJob(job.id)).questions[0].answeredAt);

console.log("\n--- later answers see the earlier ones ---");
const grown = (await store.getJob(job.id)).questions.concat([{ id: "q2", q: "Tell us about a failure.", limit: 80 }]);
await store.updateJob(job.id, { questions: grown });
prompts = [];
res = await post({ id: job.id, questionId: "q2" });
check("second answered", res.statusCode === 200, res.body);
check("prompt carried the first answer", prompts[0].includes("Why do you want to work here?"));
check("told not to repeat evidence", prompts[0].includes("Do not repeat their evidence"));

console.log("\n--- but not the ones after it ---");
prompts = [];
await post({ id: job.id, questionId: qid });
check("re-answering the first cannot see the second", !prompts[0].includes("Tell us about a failure."));

console.log("\n--- refusals ---");
reply = "CANNOT ANSWER: my profile has no salary expectation on file.";
res = await post({ id: job.id, questionId: qid });
check("marked refused", res.body.refused === true, res.body);
check("reason returned", /salary/.test(res.body.reason));
const refusedRow = (await store.getJob(job.id)).questions[0];
check("no answer text saved", refusedRow.a === "");
check("refusal persisted", refusedRow.refused === true);
reply = "A perfectly ordinary answer of a few words.";

console.log("\n--- shaping ---");
check("fence stripped", ans.finish("```\nplain words here\n```", 50).answer === "plain words here");
check("wrapping quotes stripped", ans.finish('"just this"', 50).answer === "just this");
const overRun = ans.finish("one two three four five", 3);
check("over-limit reported", overRun.over === true);
check("and not truncated", overRun.answer === "one two three four five");

console.log("\n--- per-job instructions steer it ---");
await store.updateJob(job.id, { instructions: "Lean on the agent architecture work." });
prompts = [];
await post({ id: job.id, questionId: qid });
check("instructions reached the prompt", prompts[0].includes("Lean on the agent architecture work."));

console.log("\n--- errors ---");
res = await post({ id: job.id });
check("missing questionId refused", res.statusCode === 400);
res = await post({ id: job.id, questionId: "nope" });
check("unknown question refused", res.statusCode === 404);
res = await post({ id: "nope", questionId: qid });
check("unknown job refused", res.statusCode === 404);
const blank = await store.saveJob({ company: "C", role: "R", questions: [{ q: "   " }] });
res = await post({ id: blank.id, questionId: blank.questions[0].id });
check("empty question refused", res.statusCode === 400, res.body);
let r2 = mockRes();
await answer({ method: "GET", headers: auth, body: {} }, r2);
check("GET refused", r2.statusCode === 405);
r2 = mockRes();
await answer({ method: "POST", headers: {}, body: { id: job.id, questionId: qid } }, r2);
check("no secret refused", r2.statusCode === 401);

console.log("\n--- works without a fit analysis ---");
const bare = await store.saveJob({ company: "C", role: "R", jobDescription: "Some role", questions: [{ q: "Why?" }] });
res = await post({ id: bare.id, questionId: bare.questions[0].id });
check("answered with no report linked", res.statusCode === 200, res.body);

console.log("\n--- questions stay private ---");
const rid = await store.saveReport({ job_title: "T", company: "C", job_description: "jd", created_at: new Date().toISOString() });
const linked = await store.saveJob({ company: "C", role: "R", fitReportId: rid, questions: [{ q: "secret question", a: "secret answer" }] });
res = mockRes();
await reportHandler({ method: "GET", query: { id: rid } }, res);
check("never on the public report", !JSON.stringify(res.body).includes("secret answer"), Object.keys(res.body.report || {}));
check("row still holds it", (await store.getJob(linked.id)).questions[0].a === "secret answer");

console.log("\n--- the page ---");
const html = fs.readFileSync(root + "public/admin.html", "utf8");
check("has a questions box", html.includes("qabox"));
check("answer is escaped", html.includes("esc(q.a)"));
check("question text is escaped", html.includes("esc(q.q"));
check("has a copy button", html.includes("qcopy"));
check("uses the dropped-connection recovery", html.includes("answerLanded(id, qid)"));
check("shows the count against the limit", html.includes("qa-count"));
check("add button present", html.includes("qadd"));
check("remove button present", html.includes("qdel"));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
