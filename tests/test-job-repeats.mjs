// Reposts of an opening already in the pipeline, archive or Filtered must not
// become new jobs. The rule cases are pairs that reached production in
// September and October 2026 under new LinkedIn listing ids.
import assert from "node:assert/strict";
import { findRepeat, judgeRepeat, checkRepeat, companyKey, placeKey, repostEntry, addRepost, recordJobRepost } from "../lib/job-duplicates.js";
import { executeIngestBatch } from "../lib/ingest-work.js";
import { discoverLinkedIn } from "../lib/linkedin-discovery.js";
import { recordFilteredJob, recordFilteredRepost, listFilteredForMatching, purgeFilteredJobs, resetFilteredJobsForTests } from "../lib/filtered-jobs.js";
import { saveJob, getJob, listJobs } from "../lib/store.js";
import { DEFAULT_DUPLICATE_SETTINGS, validateDuplicateSettings } from "../lib/sanity/duplicate-settings.js";
import { settingsFromDocument } from "../lib/sanity/analysis-settings.js";
import { initialSettingsDocument } from "../lib/sanity/settings-document.js";

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.error("  FAIL " + name, e); }
}
const li = id => `https://www.linkedin.com/jobs/view/${id}`;
const job = (id, company, role, location, extra = {}) => ({ kind: "job", id, company, role, location,
  externalId: `linkedin-${id}`, sourceUrl: li(id), ...extra });
const card = (id, company, role, location, extra = {}) => ({ company, role, location, externalId: `linkedin-${id}`, sourceUrl: li(id), ...extra });

await test("keys ignore legal suffixes, recruiter prefixes and broad locations", () => {
  assert.equal(companyKey("Acme Ltd"), companyKey("via ACME Limited"));
  assert.equal(placeKey("Greater London, England, United Kingdom"), "london");
  assert.equal(placeKey("London Area, United Kingdom"), "london");
  assert.equal(placeKey("England, United Kingdom"), "");
  assert.equal(placeKey("United Kingdom"), "");
});

await test("same company, title and place is a repost settled by the rules", () => {
  const existing = [job("4430630705", "Benifex", "Engineering Manager", "Southampton, England, United Kingdom")];
  const found = findRepeat(card("4473483428", "Benifex", "Engineering Manager", "Southampton, England, United Kingdom"), existing);
  assert.equal(found.by, "rules"); assert.equal(found.repeat.id, "4430630705");
  // A country-wide listing matches a city listing of the same title.
  assert.equal(findRepeat(card("4472888317", "Lead Forensics", "Software Development Manager", "United Kingdom"),
    [job("4468796356", "Lead Forensics", "Software Development Manager", "Manchester, England, United Kingdom")]).by, "rules");
  assert.equal(findRepeat(card("4472529792", "Relay Technologies", "Engineering Manager", "London Area, United Kingdom"),
    [job("4471856960", "Relay Technologies", "Engineering Manager", "Greater London, England, United Kingdom")]).by, "rules");
});

await test("different cities and reworded titles are close calls for Jev, not repeats", () => {
  const ashby = findRepeat(card("4403618575", "Ashby", "Engineering Manager - UK", "Birmingham, England, United Kingdom"),
    [job("4403602812", "Ashby", "Engineering Manager - UK", "Manchester, England, United Kingdom")]);
  assert.equal(ashby.repeat, undefined); assert.equal(ashby.near.length, 1);
  const formula = findRepeat(card("1", "Formula", "Engineering Manager", "United Kingdom"),
    [job("2", "Formula", "Software Engineering Manager", "United Kingdom")]);
  assert.equal(formula.near.length, 1);
  // Different companies and unrelated titles are never compared.
  assert.deepEqual(findRepeat(card("3", "Other Co", "Engineering Manager", ""), [job("2", "Formula", "Engineering Manager", "")]).near, []);
  assert.deepEqual(findRepeat(card("4", "Wise", "Engineering Lead - Account Details Experience", "London"),
    [job("5", "Wise", "Senior Software Engineer II - Engineering Experience", "London")]).near, []);
});

await test("the same listing is left to the existing exact match", () => {
  const found = findRepeat(card("9", "Acme", "Engineering Manager", ""), [{ ...job("9", "Acme", "Engineering Manager", ""), kind: "filtered" }]);
  assert.equal(found.repeat, undefined); assert.deepEqual(found.near, []);
});

const settings = DEFAULT_DUPLICATE_SETTINGS;
const answer = (choice, repeat) => ({ choice, probabilities: { repeat, different: 1 - repeat } });

await test("Jev compares descriptions and only a confident repeat counts", async () => {
  const near = [job("1", "Ashby", "Engineering Manager - UK", "Manchester", { jobDescription: "Lead the platform team." }),
    job("2", "Ashby", "Engineering Manager - UK", "Cardiff", { jobDescription: "Lead the payments team." })];
  let seen;
  const evaluate = async args => { seen = args; return { answers: { repeat_e0: answer("repeat", 0.92), repeat_e1: answer("different", 0.1) } }; };
  const match = await judgeRepeat(card("3", "Ashby", "Engineering Manager - UK", "Birmingham", { jobDescription: "Lead the platform team." }), near, { settings, evaluate });
  assert.equal(match.repeat.id, "1"); assert.equal(match.by, "jev"); assert.equal(match.probability, 0.92);
  assert.equal(seen.state.existing.e0.description, "Lead the platform team.");
  assert.equal(seen.state.posting.location, "Birmingham");
  assert.deepEqual(Object.keys(seen.questions[`repeat_e0`].criteria), ["repeat", "different"]);
  const unsure = await judgeRepeat(card("3", "Ashby", "x", ""), near.slice(0, 1), { settings,
    evaluate: async () => ({ answers: { repeat_e0: answer("repeat", 0.6) } }) });
  assert.equal(unsure, null);
  await assert.rejects(judgeRepeat(card("3", "Ashby", "x", ""), near.slice(0, 1), { settings, evaluate: async () => ({ answers: {} }) }));
});

await test("without published settings only the rules run", async () => {
  const near = [job("1", "Ashby", "Engineering Manager - UK", "Manchester")];
  assert.equal(await checkRepeat(card("3", "Ashby", "Engineering Manager - UK", "Birmingham"), near,
    { settings: null, evaluate: async () => assert.fail("Jev must not run") }), null);
});

await test("settings validate and stay out of the scoring fingerprint", () => {
  assert.deepEqual(validateDuplicateSettings(DEFAULT_DUPLICATE_SETTINGS), DEFAULT_DUPLICATE_SETTINGS);
  assert.throws(() => validateDuplicateSettings({ ...DEFAULT_DUPLICATE_SETTINGS, repeatProbability: 0.3 }));
  assert.throws(() => validateDuplicateSettings({ ...DEFAULT_DUPLICATE_SETTINGS, instructions: " " }));
  const doc = initialSettingsDocument();
  const withCheck = settingsFromDocument(doc);
  assert.equal(withCheck.duplicateCheck.repeatProbability, 0.8);
  const { duplicateCheck, ...rest } = doc;
  const without = settingsFromDocument(rest);
  assert.equal(without.duplicateCheck, null);
  assert.equal(without.fingerprint, withCheck.fingerprint);
});

await test("reposts are kept once per listing, newest last", () => {
  const first = repostEntry(card("1", "A", "EM", "Leeds"), { by: "rules" }, new Date("2026-10-01T00:00:00Z"));
  const again = repostEntry(card("1", "A", "EM", "Leeds"), { by: "rules" }, new Date("2026-10-02T00:00:00Z"));
  const other = repostEntry(card("2", "A", "EM", "Leeds"), { by: "jev", probability: 0.9 }, new Date("2026-10-03T00:00:00Z"));
  const list = addRepost(addRepost(addRepost([], first), other), again);
  assert.deepEqual(list.map(r => r.externalId), ["linkedin-2", "linkedin-1"]);
  assert.equal(list[0].probability, 0.9);
});

await test("a repost is recorded on the pipeline job instead of a new row", async () => {
  const saved = await saveJob({ company: "Flow Traders", role: "Engineering Manager, Research Engineering",
    location: "London, England, United Kingdom", externalId: "linkedin-4448441112", sourceUrl: li("4448441112"),
    stage: "not_interested", archived: true });
  const before = (await listJobs({ includeArchived: true })).length;
  let screened = 0;
  const result = await executeIngestBatch([{ company: "Flow Traders", role: "Engineering Manager - Research Engineering",
    location: "London Area, United Kingdom", externalId: "linkedin-4473114694", sourceUrl: li("4473114694"),
    jobDescription: "Same role, new listing." }], { screen: async () => { screened++; return { decision: "accepted" }; } });
  assert.equal(screened, 0, "a repost is never assessed");
  assert.equal(result.added, 0); assert.equal(result.repeated, 1);
  assert.equal(result.repeatedRows[0].repeatOf, saved.id); assert.equal(result.repeatedRows[0].by, "rules");
  assert.equal((await listJobs({ includeArchived: true })).length, before);
  const after = await getJob(saved.id);
  assert.equal(after.reposts.length, 1); assert.equal(after.reposts[0].externalId, "linkedin-4473114694");
  assert.equal(after.stage, "not_interested"); assert.equal(after.archived, true);
  assert.equal(after.sourceUrl, li("4448441112"), "the original listing is kept");
});

await test("a repost of a filtered job refreshes it and is not reassessed", async () => {
  resetFilteredJobsForTests();
  await recordFilteredJob({ opportunity: { company: "Immersum", role: "Engineering Manager", externalId: "linkedin-11",
    sourceUrl: li("11"), jobDescription: "Original." }, decision: "below-threshold", assessment: { score: 36, dimensions: [] },
    minimumScore: 50, now: new Date("2026-06-01T00:00:00Z") });
  let screened = 0;
  const result = await executeIngestBatch([{ company: "Immersum", role: "Engineering Manager", externalId: "linkedin-12",
    sourceUrl: li("12"), jobDescription: "Reposted." }], { screen: async () => { screened++; return { decision: "below-threshold" }; } });
  assert.equal(screened, 0); assert.equal(result.repeated, 1); assert.equal(result.repeatedRows[0].kind, "filtered");
  const [record] = await listFilteredForMatching();
  assert.equal(record.externalId, "linkedin-11");
  // The repost keeps the record from expiring.
  assert.equal((await purgeFilteredJobs({ days: 90, now: new Date("2026-10-01T00:00:00Z") })).removed, 0);
  assert.equal((await listFilteredForMatching()).length, 1);
});

await test("a close call goes to Jev with the existing description; a failed check is retried, not assessed", async () => {
  const records = [];
  const repeats = { listFiltered: async () => [], describe: async record => record.jobDescription || "",
    record: async (match, entry) => records.push([match.repeat.id, entry.matchedBy]),
    check: (posting, list, options) => checkRepeat(posting, list, { ...options, settings,
      evaluate: async ({ state }) => ({ answers: { repeat_e0: state.posting.description.includes("platform")
        ? answer("repeat", 0.95) : answer("different", 0.05) } }) }) };
  const existing = await saveJob({ company: "Seccl", role: "Engineering Manager", location: "London, England, United Kingdom",
    externalId: "linkedin-4463396817", sourceUrl: li("4463396817"), jobDescription: "Lead the platform team.", stage: "reviewing" });
  let screened = 0;
  const screen = async () => { screened++; return { decision: "below-threshold", assessment: { score: 30, dimensions: [] } }; };
  const same = await executeIngestBatch([{ company: "Seccl", role: "Engineering Manager", location: "Edinburgh, Scotland, United Kingdom",
    externalId: "linkedin-4463398682", sourceUrl: li("4463398682"), jobDescription: "Lead the platform team." }], { screen, repeats, recordFiltered: async () => ({ recorded: 0, failures: [] }) });
  assert.equal(same.repeated, 1); assert.deepEqual(records, [[existing.id, "jev"]]); assert.equal(screened, 0);
  const different = await executeIngestBatch([{ company: "Seccl", role: "Engineering Manager", location: "Edinburgh, Scotland, United Kingdom",
    externalId: "linkedin-4463398999", sourceUrl: li("4463398999"), jobDescription: "Lead the data team." }], { screen, repeats, recordFiltered: async () => ({ recorded: 0, failures: [] }) });
  assert.equal(different.repeated, 0); assert.equal(screened, 1);
  const broken = await executeIngestBatch([{ company: "Seccl", role: "Engineering Manager", location: "Edinburgh, Scotland, United Kingdom",
    externalId: "linkedin-4463398000", sourceUrl: li("4463398000"), jobDescription: "Lead a team." }],
    { screen, repeats: { ...repeats, check: async () => { throw new Error("Jev unavailable"); } } });
  assert.equal(broken.failed, 1); assert.equal(broken.screeningRows[0].decision, "repeat-check-failed"); assert.equal(screened, 1);
});

await test("discovery settles rule repeats from the card before screening or fetching", async () => {
  const recorded = [];
  const posting = { id: "4475564856", company: "Burns Sheehan", role: "Engineering Manager", location: "London Area, United Kingdom",
    sourceUrl: li("4475564856") };
  const fresh = { id: "4475564857", company: "New Co", role: "Engineering Manager", location: "Leeds", sourceUrl: li("4475564857") };
  let screenedIds;
  const report = await discoverLinkedIn({
    search: async () => ({ jobs: [posting, fresh], scans: [], complete: true }),
    list: async () => [{ id: "existing-1", company: "Burns Sheehan", role: "Engineering Manager", location: "London",
      externalId: "linkedin-4468620392", sourceUrl: li("4468620392"), stage: "expired", archived: true }],
    listFiltered: async () => [],
    recordRepeat: async (match, entry) => recorded.push([match.repeat.id, entry.externalId]),
    prescreenBatch: async cards => { screenedIds = cards.map(c => String(c.id)); return cards.map(c => ({ postingId: c.id, decision: "skip" })); },
    recordFiltered: async () => ({ recorded: 1, failures: [] }), purgeFiltered: async () => ({ removed: 0 }),
    describe: async () => assert.fail("a repeat needs no description"),
  });
  assert.deepEqual(screenedIds, ["4475564857"]);
  assert.deepEqual(recorded, [["existing-1", "linkedin-4475564856"]]);
  assert.equal(report.repeats.length, 1); assert.equal(report.repeats[0].by, "rules");
  assert.equal(report.status, "completed");
});

console.log(`passed ${passed}, failed ${failed}`);
if (failed) process.exit(1);
