import { requireAdmin } from "../_admin.js";
import { backfillIndex } from "../_store.js";

// POST /api/admin/backfill -> { backfilled: N }
// One-off migration: indexes any fit:* reports saved before the admin
// listing index existed, so they show up in /admin too. Safe to re-run.
export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const backfilled = await backfillIndex();
    res.status(200).json({ backfilled });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 300) });
  }
}
