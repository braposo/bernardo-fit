import { requireAdmin } from "../_admin.js";
import { saveJob, findExistingJob, updateJob, postingId } from "../_store.js";

// POST /api/admin/ingest  { opportunities: [ { ... } ] }
//
// The write end of a recurring inbox review. A scheduled job scans Gmail,
// extracts anything that looks like a real opportunity, and posts it here. The
// server still holds no mail credentials of its own; it only accepts what an
// authenticated caller hands it.
//
// Upsert semantics match "import from inbox": matched on externalId, then the
// board posting id, then company and role, then the Gmail thread. Anything the
// user owns on an existing row (stage, notes, the linked analysis, archived
// state, and any score from a previous analysis) is left alone. New rows arrive
// unscored, because scoring is a product of running the analysis rather than of
// the scan.
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
    // Rows that matched on something other than the externalId sent. The scan
    // thought each of these was new, so surfacing them is how id drift stays
    // visible rather than turning back into duplicate rows.
    const mergedRows = [];

    for (const raw of list) {
      if (!raw || typeof raw !== "object") { skipped++; continue; }
      const opp = clean(raw);
      if (!opp.company && !opp.role) { skipped++; continue; }
      if (!opp.externalId && !opp.threadId) { skipped++; continue; }

      const existing = await findExistingJob(opp);
      if (existing) {
        if (opp.externalId && existing.externalId !== opp.externalId) {
          const pid = postingId(opp.sourceUrl);
          mergedRows.push({
            id: existing.id,
            company: existing.company,
            role: existing.role,
            sentAs: opp.externalId,
            matchedOn: pid && postingId(existing.sourceUrl) === pid ? "posting id" : "company and role",
          });
        }
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
          // Keep whichever description says more. An empty one must not wipe
          // what is held, and a re-scan that only managed a summary must not
          // replace the full posting text a previous run fetched, or anything
          // pasted in by hand.
          jobDescription:
            (opp.jobDescription || "").length > (existing.jobDescription || "").length
              ? opp.jobDescription
              : existing.jobDescription,
        });
        updated++;
      } else {
        const row = await saveJob({ ...opp, stage: "new" });
        added++;
        addedRows.push({ id: row.id, company: row.company, role: row.role });
      }
    }

    res.status(200).json({ added, updated, skipped, addedRows, mergedRows });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 300) });
  }
}
