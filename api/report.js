import { getReport } from "./_store.js";

// GET /api/report?id=abc123  -> { report }
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { id } = req.query || {};
  if (!id) {
    res.status(400).json({ error: "Missing id" });
    return;
  }

  try {
    const report = await getReport(id);
    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }
    res.status(200).json({ report });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 300) });
  }
}
