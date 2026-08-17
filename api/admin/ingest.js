import { requireAdmin } from "../_admin.js";
import { saveJob, findExistingJob, updateJob } from "../_store.js";

// POST /api/admin/ingest  { opportunities: [ { ... } ] }
//
// The write end of a recurring inbox review. A scheduled job scans Gmail,
// extracts anything that looks like a real opportunity, and posts it here. The
// server still holds no mail credentials of its own; it only accepts what an
// authenticated caller hands it.
//
// Upsert semantics match "import from inbox": matched on externalId then Gmail
// threadId, and anything the user owns on an existing row (stage, notes, the
// linked analysis, archived state, and any score from a previous analysis) is
// left alone. New rows arrive unscored, because scoring is a product of running
// the analysis rather than of the scan.
const ALLOWED = [
  "externalId", "company", "role", "source", "sourceType", "sourceUrl",
  "threadId", "location", "locationMode", "salary", "jobDescription",
  "receivedAt", "notes", "replyOwed", "recruiter", "closed",
];

function clean(raw) {
  const out = {};
  for (const k of ALLOWED) if (raw[k] !== undefined) out[k] = raw[k];
  return out;
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const list = (req.body && req.body.opportunities) || [];
  if (!Array.isArray(list)) {
    res.status(400).json({ error: "Expected an opportunities array." });
    return;
  }
  if (list.length > 200) {
    res.status(400).json({ error: "Too many at once; send 200 or fewer." });
    return;
  }

  try {
    let added = 0, updated = 0, skipped = 0;
    const addedRows = [];

    for (const raw of list) {
      if (!raw || typeof raw !== "object") { skipped++; continue; }
      const opp = clean(raw);
      if (!opp.company && !opp.role) { skipped++; continue; }
      if (!opp.externalId && !opp.threadId) { skipped++; continue; }

      const existing = await findExistingJob(opp);
      if (existing) {
        await updateJob(existing.id, {
          ...opp,
          stage: existing.stage,
          notes: existing.notes || opp.notes || "",
          fitReportId: existing.fitReportId,
          archived: existing.archived,
          archivedAt: existing.archivedAt,
          createdAt: existing.createdAt,
          score: existing.score,
          tier: existing.tier,
          scoreBreakdown: existing.scoreBreakdown,
          rationale: existing.rationale,
          // Don't overwrite a description already captured with an empty one.
          jobDescription: opp.jobDescription || existing.jobDescription,
        });
        updated++;
      } else {
        const row = await saveJob({ ...opp, stage: "new" });
        added++;
        addedRows.push({ id: row.id, company: row.company, role: row.role });
      }
    }

    res.status(200).json({ added, updated, skipped, addedRows });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 300) });
  }
}
