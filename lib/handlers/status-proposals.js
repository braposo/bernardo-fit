// HTTP for email status proposals and the interview timeline. Served through
// /api/admin/jobs to stay within the hosting plan's function count.
//
// Routine (x-routine-secret or x-admin-secret):
// GET  /api/admin/jobs?routine=match&from=&subject=&threadId=&company= -> { candidates }
// POST /api/admin/jobs?routine=proposal                              -> 201 { created: true, proposal }
//                                                                       200 { created: false, reason, proposal? }
// Admin (x-admin-secret, dispatched from the jobs handler):
// GET  ?proposals=1[&state=open|applied|dismissed|all][&jobId=]     -> { proposals }
// POST { action: "apply-proposal" | "dismiss-proposal", id }
// POST { action: "timeline-add", id: jobId, entry }
// POST { action: "timeline-edit", id: jobId, entryId, entry }
// POST { action: "timeline-remove", id: jobId, entryId }
import { requireRoutine } from "../admin.js";
import { listJobs, getJob, mutateJob } from "../store.js";
import { withSettingsHandler } from "../sanity/settings-handler.js";
import { emailStatusSettings } from "../sanity/analysis-settings.js";
import { matchEmailToJobs, createStatusProposal, listStatusProposals, applyStatusProposal, decideStatusProposal } from "../status-proposals.js";
import { timelineEntry, timelineView, addTimelineEntry, editTimelineEntry, removeTimelineEntry } from "../interview-timeline.js";

const param = (value, max) => typeof value === "string" ? value.slice(0, max) : "";

async function routine(req, res) {
  if (req.method === "GET" && req.query?.routine === "match") {
    const query = { from: param(req.query.from, 320), subject: param(req.query.subject, 300),
      threadId: param(req.query.threadId, 200), company: param(req.query.company, 200) };
    if (!query.from && !query.subject && !query.threadId && !query.company) return res.status(400).json({ error: "Send from, subject, threadId or company." });
    // Archived jobs are included: a closed role can still get a reply.
    return res.status(200).json({ candidates: matchEmailToJobs(await listJobs({ includeArchived: true }), query) });
  }
  if (req.method === "POST" && req.query?.routine === "proposal") {
    const body = req.body || {};
    const job = typeof body.jobId === "string" && body.jobId ? await getJob(body.jobId) : null;
    const result = await createStatusProposal(body, { job, settings: emailStatusSettings() });
    return res.status(result.created ? 201 : 200).json(result);
  }
  return res.status(405).json({ error: "Method not allowed" });
}

const settingsRoutine = withSettingsHandler(routine, { admin: false });
export async function routineHandler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!requireRoutine(req, res)) return;
  try { return await settingsRoutine(req, res); }
  catch (err) { res.status(err.status || 500).json({ error: err.status ? err.message : "Unexpected error" }); }
}

export async function listProposalsResponse(query) {
  return { proposals: await listStatusProposals({ state: param(query.state, 20) || "open", jobId: param(query.jobId, 200) }) };
}

const timelineResult = job => job ? { status: 200, json: { id: job.id, revision: job.revision, interviewTimeline: timelineView(job.interviewTimeline) } }
  : { status: 404, json: { error: "Job not found" } };

// Admin POST actions. Returns { status, json }, or null when the action is not
// one of these. changeJob is the jobs PATCH path: (id, body, { extraPatch }).
export async function proposalAction(body, { changeJob }) {
  switch (body.action) {
    case "apply-proposal":
      if (typeof body.id !== "string" || !body.id) return { status: 400, json: { error: "Missing proposal id" } };
      return applyStatusProposal(body.id, { getJob, changeJob });
    case "dismiss-proposal":
      if (typeof body.id !== "string" || !body.id) return { status: 400, json: { error: "Missing proposal id" } };
      return { status: 200, json: { proposal: await decideStatusProposal(body.id, "dismissed") } };
    case "timeline-add": {
      if (typeof body.id !== "string" || !body.id) return { status: 400, json: { error: "Missing job id" } };
      const entry = timelineEntry(body.entry);
      return timelineResult(await mutateJob(body.id, current => addTimelineEntry(current, entry)));
    }
    case "timeline-edit":
    case "timeline-remove": {
      if (typeof body.id !== "string" || !body.id || typeof body.entryId !== "string" || !body.entryId) return { status: 400, json: { error: "Missing job or entry id" } };
      const now = new Date();
      return timelineResult(await mutateJob(body.id, current => body.action === "timeline-edit"
        ? editTimelineEntry(current, body.entryId, body.entry, { now }) : removeTimelineEntry(current, body.entryId)));
    }
    default: return null;
  }
}
