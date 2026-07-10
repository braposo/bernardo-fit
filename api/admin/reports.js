import { requireAdmin } from "../_admin.js";
import { listReports, deleteReport } from "../_store.js";

// GET    /api/admin/reports?offset=&limit=   -> { reports, total }
// DELETE /api/admin/reports?id=abc123        -> { ok: true }
export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  if (req.method === "GET") {
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    try {
      const { reports, total } = await listReports({ offset, limit });
      res.status(200).json({ reports, total });
    } catch (err) {
      res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 300) });
    }
    return;
  }

  if (req.method === "DELETE") {
    const { id } = req.query || {};
    if (!id) {
      res.status(400).json({ error: "Missing id" });
      return;
    }
    try {
      const ok = await deleteReport(id);
      if (!ok) {
        res.status(404).json({ error: "Report not found" });
        return;
      }
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 300) });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}
