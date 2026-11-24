import assert from "node:assert/strict";
import { linkedInJobId } from "../public/linkedin-job-link.js";
import { addLinkedInJob, LINK_SOURCE } from "../lib/linkedin-link.js";
import { parseLinkedInPosting, linkedinOpportunity } from "../lib/linkedin-source.js";
import { completeMovedJob } from "../lib/filtered-job-enrich.js";
import { createJobIfAbsent, getJob, listJobs, mutateJob } from "../lib/store.js";
import { matchesSearch } from "../lib/job-view.js";
import { workCompletion, coverPhaseText } from "../public/admin-run.js";
import handler from "../api/admin/jobs.js";

process.env.ADMIN_SECRET = "synthetic-admin";
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.error("  FAIL " + name, e); }
}
function call(body) {
  return new Promise(resolve => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(code) { this.statusCode = code; return this; }, json(data) { resolve({ status: this.statusCode, body: data }); return this; } };
    handler({ method: "POST", query: {}, body, headers: { "x-admin-secret": "synthetic-admin" } }, res);
  });
}

// Trimmed from the public guest posting markup LinkedIn serves today.
const DESCRIPTION = "Lead the supply chain security engineering team. ".repeat(8);
const POSTING_HTML = `<section class="top-card-layout container-lined overflow-hidden babybear:rounded-[0px]">
  <a href="https://uk.linkedin.com/jobs/view/engineering-manager-sscs-supply-chain-at-gitlab-4484959226?trk=public_jobs_topcard-title" class="topcard__link">
    <h2 class="top-card-layout__title font-sans text-lg papabear:text-xl font-bold leading-open text-color-text mb-0 topcard__title">Engineering Manager, SSCS: Supply Chain</h2>
  </a>
  <h4 class="top-card-layout__second-subline font-sans text-sm leading-open text-color-text-low-emphasis mt-0.5">
    <div class="topcard__flavor-row">
      <span class="topcard__flavor">
        <a class="topcard__org-name-link topcard__flavor--black-link" href="https://www.linkedin.com/company/gitlab-com?trk=public_jobs_topcard-org-name">
          GitLab
        </a>
      </span>
      <span class="topcard__flavor topcard__flavor--bullet">
        United Kingdom
      </span>
    </div>
  </h4>
</section>
<div class="description__text description__text--rich"><section class="show-more-less-html" data-max-lines="5">
  <div class="show-more-less-html__markup show-more-less-html__markup--clamp-after-5"><p>${DESCRIPTION}</p></div>
</section></div>`;

await test("reads the posting ID from the links LinkedIn shares", () => {
  const id = "4484959226";
  for (const link of [
    `https://www.linkedin.com/jobs/view/${id}`,
    `https://www.linkedin.com/jobs/view/${id}/?trackingId=abc%3D%3D&refId=x`,
    `https://uk.linkedin.com/jobs/view/engineering-manager-sscs-supply-chain-at-gitlab-${id}?trk=public_jobs_topcard-title`,
    `https://www.linkedin.com/comm/jobs/view/${id}`,
    `https://www.linkedin.com/jobs/search/?currentJobId=${id}&keywords=engineering%20manager`,
    `https://www.linkedin.com/jobs/collections/recommended/?currentJobId=${id}`,
    `linkedin.com/jobs/view/${id}`,
    `Check out this job at GitLab: https://www.linkedin.com/jobs/view/${id}`,
  ]) assert.equal(linkedInJobId(link), id, link);
  for (const other of ["", "engineering manager", "https://www.linkedin.com/in/someone",
    "https://www.linkedin.com/company/gitlab-com", `https://evil.example/jobs/view/${id}`,
    `https://linkedin.com.evil.example/jobs/view/${id}`, "https://www.linkedin.com/jobs/search/?keywords=em", `javascript:alert(1)//linkedin.com/jobs/view/${id}`])
    assert.equal(linkedInJobId(other), "", other);
});

await test("reads the title, company and location from the posting page", async () => {
  assert.deepEqual(parseLinkedInPosting(POSTING_HTML),
    { role: "Engineering Manager, SSCS: Supply Chain", company: "GitLab", location: "United Kingdom" });
  const fetchImpl = async () => new Response(POSTING_HTML, { status: 200 });
  const opp = await linkedinOpportunity({ id: "4484959226", company: "", role: "", location: "",
    sourceUrl: "https://www.linkedin.com/jobs/view/4484959226" }, { fetchImpl });
  assert.equal(opp.company, "GitLab"); assert.equal(opp.role, "Engineering Manager, SSCS: Supply Chain");
  assert.equal(opp.location, "United Kingdom"); assert.match(opp.jobDescription, /supply chain security/);
  // A card from a search keeps its own fields.
  const card = await linkedinOpportunity({ id: "4484959226", company: "Card Co", role: "Card role", location: "Leeds",
    sourceUrl: "https://www.linkedin.com/jobs/view/4484959226" }, { fetchImpl });
  assert.equal(card.company, "Card Co"); assert.equal(card.location, "Leeds");
});

await test("a pasted link saves the role at New and starts the details and fit work", async () => {
  const started = [];
  const out = await addLinkedInJob("https://uk.linkedin.com/jobs/view/em-at-acme-7000000001?trk=x",
    { start: async job => { started.push(job.id); return { ...job, jevRun: { runId: "run_link1", status: "queued" } }; } });
  assert.equal(out.created, true); assert.equal(out.job.jevRun.runId, "run_link1");
  const saved = await getJob(out.job.id);
  assert.deepEqual(started, [saved.id]);
  assert.equal(saved.stage, "new"); assert.equal(saved.source, LINK_SOURCE);
  assert.equal(saved.sourceUrl, "https://www.linkedin.com/jobs/view/7000000001");
  assert.equal(saved.externalId, "linkedin-7000000001");
  // The same posting again, in any link form, opens the saved role.
  const again = await addLinkedInJob("https://www.linkedin.com/jobs/search/?currentJobId=7000000001",
    { start: async () => { throw new Error("should not start"); } });
  assert.equal(again.existing.id, saved.id);
  assert.equal((await listJobs()).filter(j => j.externalId === "linkedin-7000000001").length, 1);
  await assert.rejects(addLinkedInJob("https://example.com/job/1"), { status: 400 });
});

await test("a scanned posting already archived is found, not added again", async () => {
  await createJobIfAbsent("ing_scan_archived", { company: "Scan Co", role: "Head of Engineering", stage: "rejected", archived: true,
    externalId: "linkedin-7000000002", sourceUrl: "https://www.linkedin.com/jobs/view/7000000002" });
  const out = await addLinkedInJob("https://www.linkedin.com/jobs/view/head-of-engineering-at-scan-co-7000000002",
    { start: async () => { throw new Error("should not start"); } });
  assert.equal(out.existing.id, "ing_scan_archived");
});

await test("the admin endpoint returns the new role, or the saved one", async () => {
  assert.equal((await call({ action: "add-linkedin", url: "not a link" })).status, 400);
  assert.equal((await call({ action: "add-linkedin" })).status, 400);
  delete process.env.TYPESAFE_API_KEY; // Jev off: the role is saved without starting work.
  const added = await call({ action: "add-linkedin", url: "https://www.linkedin.com/jobs/view/7000000003" });
  assert.equal(added.status, 200); assert.equal(added.body.job.source, LINK_SOURCE); assert.ok(!added.body.existing);
  const same = await call({ action: "add-linkedin", url: "https://www.linkedin.com/jobs/view/7000000003/?refId=1" });
  assert.equal(same.status, 200); assert.equal(same.body.existing.id, added.body.job.id);
});

const noRepeats = { list: async () => [], check: async () => null, record: async () => {}, remove: async () => {} };

await test("completion replaces the placeholders with the posting's details, then assesses fit", async () => {
  const { job } = await addLinkedInJob("https://www.linkedin.com/jobs/view/7000000004", { start: async j => j });
  await mutateJob(job.id, () => ({ jevRun: { requestId: "link-4", runId: "run_4", status: "queued", fingerprint: "" } }));
  const phases = [], asked = [];
  const result = await completeMovedJob({ jobId: job.id, requestId: "link-4" }, {
    progress: p => phases.push(p), repeats: noRepeats,
    fetchDescription: async posting => { asked.push(posting);
      return { company: "GitLab", role: "Engineering Manager", location: "United Kingdom", jobDescription: DESCRIPTION,
        notes: "Discovered through public LinkedIn search.", sourceType: "job-board" }; },
    assess: async payload => ({ outcome: "completed", ...payload }) });
  assert.equal(result.outcome, "completed");
  assert.equal(asked[0].company, ""); assert.equal(asked[0].role, "", "the placeholder title is never sent as the card");
  assert.deepEqual(phases, ["fetching", "checking", "scoring"]);
  const saved = await getJob(job.id);
  assert.equal(saved.company, "GitLab"); assert.equal(saved.role, "Engineering Manager"); assert.equal(saved.location, "United Kingdom");
  assert.match(saved.notes, /Added from a LinkedIn link/);
});

await test("an opening already in the pipeline under another link is dropped and noted on the saved role", async () => {
  await createJobIfAbsent("ing_saved_em", { company: "Acme", role: "Engineering Manager", stage: "applied", location: "Leeds",
    externalId: "jsearch-acme-em", sourceUrl: "https://jobs.acme.example/em", jobDescription: DESCRIPTION });
  const { job } = await addLinkedInJob("https://www.linkedin.com/jobs/view/7000000005", { start: async j => j });
  await mutateJob(job.id, () => ({ jevRun: { requestId: "link-5", runId: "run_5", status: "queued", fingerprint: "" } }));
  const recorded = [], removed = [];
  const repeats = { list: () => listJobs({ includeArchived: true }),
    check: async (posting, records) => { assert.ok(!records.some(r => r.id === job.id), "never compared with itself");
      return { repeat: records.find(r => r.id === "ing_saved_em"), by: "rules" }; },
    record: async (match, entry) => recorded.push({ id: match.repeat.id, entry }), remove: async id => removed.push(id) };
  const result = await completeMovedJob({ jobId: job.id, requestId: "link-5" }, { repeats,
    fetchDescription: async () => ({ company: "Acme", role: "Engineering Manager", location: "Leeds", jobDescription: DESCRIPTION }),
    assess: async () => { throw new Error("should not assess a duplicate"); } });
  assert.equal(result.outcome, "duplicate"); assert.equal(result.repeatOf, "ing_saved_em");
  assert.equal(result.company, "Acme");
  assert.deepEqual(removed, [job.id]);
  assert.equal(recorded[0].id, "ing_saved_em"); assert.equal(recorded[0].entry.sourceUrl, "https://www.linkedin.com/jobs/view/7000000005");
  const toast = workCompletion({ ok: true, d: { kind: "filtered-enrich", status: "COMPLETED", result } });
  assert.equal(toast.text, "Already in your pipeline: Acme · Engineering Manager"); assert.equal(toast.jobId, "ing_saved_em");
  assert.match(coverPhaseText({ phase: "checking" }), /already in your pipeline/);
});

await test("an unavailable repost check never blocks the role", async () => {
  const { job } = await addLinkedInJob("https://www.linkedin.com/jobs/view/7000000006", { start: async j => j });
  await mutateJob(job.id, () => ({ jevRun: { requestId: "link-6", runId: "run_6", status: "queued", fingerprint: "" } }));
  const repeats = { ...noRepeats, list: async () => [{ id: "other", company: "X", role: "Y" }],
    check: async () => { throw new Error("Jev unavailable"); } };
  const result = await completeMovedJob({ jobId: job.id, requestId: "link-6" }, { repeats,
    fetchDescription: async () => ({ company: "Beta", role: "CTO", jobDescription: DESCRIPTION }),
    assess: async payload => ({ outcome: "completed", ...payload }) });
  assert.equal(result.outcome, "completed");
});

await test("searching with a LinkedIn link finds the role for that posting", () => {
  const job = { company: "GitLab", role: "EM", externalId: "linkedin-4484959226", sourceUrl: "https://www.linkedin.com/jobs/view/4484959226" };
  assert.ok(matchesSearch(job, "https://uk.linkedin.com/jobs/view/em-at-gitlab-4484959226?trk=x"));
  assert.ok(!matchesSearch(job, "https://www.linkedin.com/jobs/view/4484959227"));
  assert.ok(matchesSearch(job, "gitlab"));
});

console.log(`passed ${passed}, failed ${failed}`);
if (failed) process.exit(1);
