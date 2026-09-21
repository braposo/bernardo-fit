process.env.ADMIN_SECRET = "test-secret-value";
process.env.ANTHROPIC_API_KEY = "sk-fake";
// Paths are derived rather than hard-coded so the suite runs from a clone.
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/") + "/";
const base = "file:///" + root + "api/";
const lib = "file:///" + root + "lib/";

import fs from "node:fs";

let sentModels = [];
let variant = 1;
globalThis.fetch = async (_u, opts) => {
  const b = JSON.parse(opts.body);
  sentModels.push(b.model);
  return {
    ok: true,
    json: async () => ({
      content: [{ type: "text", text: JSON.stringify({
        job_title: "Role v" + variant, company: "C", pitch: "p", categories: [], differentiators: [], closing: "c",
        internal: { score: 50 + variant, tier: "Worth a look", breakdown: { location: 1, aiDx: 1, leadership: 1 }, reasoning: "r" + variant },
        salutation: "Dear team,", paragraphs: [{ lead: true, text: "Draft number " + variant + " with a few words in it." }],
      }) }],
      stop_reason: "end_turn",
    }),
  };
};

const store = await import(lib + "store.js");
const { analyseHandler: analyse, regenerateHandler: regen } = await import("./release-d-harness.mjs");
const { executeCoverWork } = await import(lib + "cover-work.js");
const { getActiveCoverArtifact, listCoverVersions } = await import(lib + "cover-artifacts.js");
const { coverFingerprint } = await import(lib + "generation-fingerprint.js");
const { saveScreenArtifact } = await import(lib + "screen-artifacts.js");
const versions = (await import(base + "admin/versions.js")).default;
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
const call = async (h, req) => { const r = mockRes(); await h(req, r); return r; };
async function generateCover(jobId, model = "claude-opus-5", requestId) {
  const current = await store.getJob(jobId);
  const report = await store.getReport(current.fitReportId);
  const fingerprint = coverFingerprint(current, report, model);
  await store.updateJob(jobId, { coverRun: { requestId, fingerprint, status: "queued" } });
  return executeCoverWork({ jobId, requestId, fingerprint, model, origin: "https://fit.bernardoraposo.com" });
}

console.log("\n--- a first analysis creates version one ---");
const job = await store.saveJob({ company: "Acme", role: "R", jobDescription: "A long enough job description for a leadership role." });
variant = 1;
await call(analyse, { method: "POST", headers: auth, body: { id: job.id } });
const rid = (await store.getJob(job.id)).fitReportId;
let res = await call(versions, { method: "GET", headers: auth, query: { id: job.id } });
check("listed", res.statusCode === 200, res.body);
check("one fit version", res.body.fit.length === 1, res.body.fit);
check("it is live", res.body.fit[0].active === true);
check("model recorded", res.body.fit[0].model === "claude-opus-5", res.body.fit[0]);
check("no writer score snapshotted", res.body.fit[0].score === null, res.body.fit[0]);
check("no letter versions yet", res.body.letter.length === 0);

console.log("\n--- regenerating keeps the old one ---");
const jevAssessment = { score: 73, model: "typesafe-ai/jev", fingerprint: "preserved" };
await store.updateJob(job.id, { jevAssessment });
variant = 2;
await call(regen, { method: "POST", headers: auth, body: { id: rid, jobId: job.id } });
res = await call(versions, { method: "GET", headers: auth, query: { id: job.id } });
check("two versions now", res.body.fit.length === 2, res.body.fit);
check("newest first and live", res.body.fit[0].active === true && res.body.fit[1].active === false);
check("live report is the new one", (await store.getReport(rid)).job_title === "Role v2");
check("new version does not score row", (await store.getJob(job.id)).score === null);
check("new version preserves Jev assessment", JSON.stringify((await store.getJob(job.id)).jevAssessment) === JSON.stringify(jevAssessment));

console.log("\n--- switching back ---");
const olderVid = res.body.fit[1].vid;
res = await call(versions, { method: "POST", headers: auth, body: { id: job.id, kind: "fit", vid: olderVid } });
check("switch accepted", res.statusCode === 200, res.body);
check("live report reverted", (await store.getReport(rid)).job_title === "Role v1");
check("permalink unchanged", (await store.getJob(job.id)).fitReportId === rid);
check("restoring version does not score row", (await store.getJob(job.id)).score === null, (await store.getJob(job.id)).score);
check("restoring version preserves Jev assessment", JSON.stringify((await store.getJob(job.id)).jevAssessment) === JSON.stringify(jevAssessment));
res = await call(versions, { method: "GET", headers: auth, query: { id: job.id } });
check("active flag moved", res.body.fit.find((v) => v.vid === olderVid).active === true);
check("and only one is live", res.body.fit.filter((v) => v.active).length === 1);

console.log("\n--- the public page follows whatever is live ---");
res = await call(reportHandler, { method: "GET", query: { id: rid } });
check("public sees the chosen version", res.body.report.job_title === "Role v1", res.body.report.job_title);
check("and still no scoring", !("internal" in res.body.report));

console.log("\n--- cover letters keep their drafts ---");
variant = 3;
await generateCover(job.id, "claude-opus-5", "version03");
variant = 4;
await generateCover(job.id, "claude-sonnet-5", "version04");
res = await call(versions, { method: "GET", headers: auth, query: { id: job.id } });
check("two letter versions", res.body.letter.length === 2, res.body.letter);
check("newest is live", res.body.letter[0].active === true);
check("models differ", res.body.letter[0].model === "claude-sonnet-5" && res.body.letter[1].model === "claude-opus-5", res.body.letter.map((v) => v.model));
check("word counts recorded", res.body.letter.every((v) => v.words > 0));
const firstLetter = res.body.letter[1].vid;
res = await call(versions, { method: "POST", headers: auth, body: { id: job.id, kind: "letter", vid: firstLetter } });
check("letter switch accepted", res.statusCode === 200, res.body);
const after = await store.getJob(job.id);
const activeLetter = await getActiveCoverArtifact(after);
check("live letter is the older draft", activeLetter.paragraphs[0].html.indexOf("Draft number 3") !== -1, activeLetter.paragraphs[0]);
check("live model followed it", after.coverLetterModel === "claude-opus-5");
check("only one letter is live", (await listCoverVersions(after)).filter((v) => v.active).length === 1);
check("letter bodies are absent from the job", after.coverLetter === null && after.coverLetterVersions.length === 0);

console.log("\n--- research and brief artifacts are grouped too ---");
await saveScreenArtifact("research", job.id, "research-old", { at: "2026-08-01T00:00:00.000Z", model: "claude-sonnet-5", sources: [{ url: "https://a.test" }] });
await saveScreenArtifact("research", job.id, "research-new", { at: "2026-09-01T00:00:00.000Z", model: "claude-opus-5", sources: [{ url: "https://b.test" }, { url: "https://c.test" }] });
await saveScreenArtifact("brief", job.id, "brief-one", { at: "2026-09-02T00:00:00.000Z", model: "claude-opus-5", opening: "Hello" });
await store.updateJob(job.id, { researchId: "research-new", researchAt: "2026-09-01T00:00:00.000Z", researchFingerprint: "fresh",
  briefId: "brief-one", briefAt: "2026-09-02T00:00:00.000Z", briefFingerprint: "fresh" });
res = await call(versions, { method: "GET", headers: auth, query: { id: job.id } });
check("research versions listed with one active", res.body.research.length === 2 && res.body.research.filter((v) => v.active).length === 1, res.body.research);
check("brief version listed active", res.body.brief.length === 1 && res.body.brief[0].active, res.body.brief);
res = await call(versions, { method: "POST", headers: auth, body: { id: job.id, kind: "research", vid: "research-old" } });
check("older research activates explicitly", res.statusCode === 200 && (await store.getJob(job.id)).researchId === "research-old", res.body);
check("activated old research is truthfully stale", (await store.getJob(job.id)).researchFingerprint === "");

console.log("\n--- listings stay small ---");
res = await call(versions, { method: "GET", headers: auth, query: { id: job.id } });
check("no report bodies in the listing", !JSON.stringify(res.body).includes("differentiators"));
check("no letter bodies in the listing", !JSON.stringify(res.body).includes("Draft number"));

console.log("\n--- legacy embedded letters migrate when selected ---");
const legacyParagraphs = [{ html: "Legacy active draft" }];
const legacy = await store.saveJob({
  company: "Legacy", role: "R", coverLetter: legacyParagraphs,
  coverLetterAt: "2026-01-02T00:00:00.000Z", coverLetterModel: "claude-opus-5",
  coverLetterVersions: [
    { vid: "legacy02", at: "2026-01-02T00:00:00.000Z", model: "claude-opus-5", words: 3, salutation: "Dear team,", paragraphs: legacyParagraphs, active: true },
    { vid: "legacy01", at: "2026-01-01T00:00:00.000Z", model: "claude-sonnet-5", words: 3, salutation: "Hello team,", paragraphs: [{ html: "Legacy older draft" }], active: false },
  ],
});
res = await call(versions, { method: "GET", headers: auth, query: { id: legacy.id } });
check("legacy metadata stays readable", res.body.letter.length === 2 && res.body.letter[0].active);
res = await call(versions, { method: "POST", headers: auth, body: { id: legacy.id, kind: "letter", vid: "legacy01" } });
check("legacy selection migrates successfully", res.statusCode === 200, res.body);
const migratedLegacy = await store.getJob(legacy.id);
check("legacy bodies leave the job", migratedLegacy.coverLetter === null && migratedLegacy.coverLetterVersions.length === 0);
check("migrated active body is readable", (await getActiveCoverArtifact(migratedLegacy)).paragraphs[0].html === "Legacy older draft");
check("migrated version count remains", migratedLegacy.coverLetterVersionCount === 2, migratedLegacy.coverLetterVersionCount);

console.log("\n--- errors ---");
const beforePreview = await store.getJob(job.id);
const fitVersions = await store.listReportVersions(rid);
const inactiveFit = fitVersions.find(v => !v.active);
res = await call(versions, { method: 'GET', headers: auth, query: { id: job.id, kind: 'fit', vid: inactiveFit.vid } });
check('preview reads the requested historical content', res.body.content.job_title === inactiveFit.report.job_title);
check('preview does not expose stored input or internal fields', !('internal' in res.body.content) && !('jobDescription' in res.body.content));
check('preview does not activate the fit version', (await store.listReportVersions(rid)).find(v => v.vid === inactiveFit.vid).active === false);
check('preview does not mutate the job', JSON.stringify(await store.getJob(job.id)) === JSON.stringify(beforePreview));
const coverVersions = await listCoverVersions(beforePreview);
res = await call(versions, { method: 'GET', headers: auth, query: { id: job.id, kind: 'letter', vid: coverVersions[0].vid } });
check('letter preview includes paragraphs', res.statusCode === 200 && res.body.content.paragraphs.length > 0);
check('preview cannot read another jobs letter', (await call(versions, { method: 'GET', headers: auth, query: { id: legacy.id, kind: 'letter', vid: coverVersions[0].vid } })).statusCode === 404);
check('preview requires admin authentication', (await call(versions, { method: 'GET', headers: {}, query: { id: job.id, kind: 'fit', vid: inactiveFit.vid } })).statusCode === 401);
check("unknown version", (await call(versions, { method: "POST", headers: auth, body: { id: job.id, kind: "fit", vid: "nope" } })).statusCode === 404);
check("bad kind", (await call(versions, { method: "POST", headers: auth, body: { id: job.id, kind: "banana", vid: "x" } })).statusCode === 400);
check("unknown job", (await call(versions, { method: "GET", headers: auth, query: { id: "nope" } })).statusCode === 404);
check("no secret", (await call(versions, { method: "GET", headers: {}, query: { id: job.id } })).statusCode === 401);
check("wrong method", (await call(versions, { method: "DELETE", headers: auth, query: { id: job.id } })).statusCode === 405);
const noFit = await store.saveJob({ company: "X", role: "R" });
check("no analysis yet", (await call(versions, { method: "POST", headers: auth, body: { id: noFit.id, kind: "fit", vid: "x" } })).statusCode === 409);

console.log("\n--- versions are capped ---");
const many = await store.saveJob({ company: "Many", role: "R", jobDescription: "Another long enough job description here." });
await call(analyse, { method: "POST", headers: auth, body: { id: many.id, model: "claude-sonnet-5" } });
const mrid = (await store.getJob(many.id)).fitReportId;
for (let i = 0; i < 14; i++) await call(regen, { method: "POST", headers: auth, body: { id: mrid, jobId: many.id } });
check("fit capped at 10", (await store.listReportVersions(mrid)).length === 10, (await store.listReportVersions(mrid)).length);
for (let i = 0; i < 12; i++) await generateCover(many.id, "claude-opus-5", "manycover" + i);
check("letters capped at 10", (await listCoverVersions(await store.getJob(many.id))).length === 10);

console.log("\n--- the page ---");
const html = fs.readFileSync(root + "public/admin.html", "utf8");
check("versions box present", html.includes("verbox"));
check("loads metadata in Documents", html.includes("if (!loaded) loadVersions()") && html.includes('workspaceSection === "materials"'));
check("preview is distinct from activation", html.includes('data-act="verpreview"') && html.includes('data-act="veruse"'));
check("marks the active one", html.includes('class="vlive">Live'));

console.log("\n=========================");
console.log("passed " + pass + ", failed " + fail);
process.exit(fail ? 1 : 0);
