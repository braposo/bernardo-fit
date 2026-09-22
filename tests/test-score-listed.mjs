import assert from "node:assert/strict";
import { scoringFingerprint } from "../lib/jev-scoring.js";
import { selectScoringCandidates, summariseScoringBatch } from "../lib/score-listed.js";

const jobs = [
  { id: "one", company: "One", role: "Lead", jobDescription: "Detailed posting", archived: false },
  { id: "two", company: "Two", role: "Engineer", jobDescription: "", archived: false },
  { id: "three", company: "Three", role: "Manager", jobDescription: "Detailed posting", archived: false },
  { id: "four", company: "Four", role: "Director", jobDescription: "Detailed posting", archived: true },
];
const reviewed = [jobs[0], jobs[1], jobs[3]].map((job) => ({ id: job.id, fingerprint: scoringFingerprint(job) }));
assert.deepEqual(selectScoringCandidates(jobs, reviewed).map((job) => job.id), ["one", "two"],
  "only reviewed active roles run, including a role with a sparse description");
assert.deepEqual(selectScoringCandidates([{ ...jobs[0], instructions: "Changed" }, ...jobs.slice(1)], reviewed).map((job) => job.id), ["two"],
  "changed assessment inputs cannot run under the old review");
const result = summariseScoringBatch(jobs.slice(0, 3), [
  { ok: true, output: { outcome: "completed" } },
  { ok: true, output: { outcome: "superseded" } },
  { ok: false, error: { message: "Unavailable" } },
]);
assert.equal(result.assessed, 1);
assert.equal(result.superseded, 1);
assert.equal(result.failed, 1);
assert.equal(result.failures[0].id, "three");
console.log("passed 1, failed 0");
