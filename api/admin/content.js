import { requireAdmin } from "../../lib/admin.js";
import { contentStatus, listContent, readContent, validateContentType, validateContentId,
  contentPage } from "../../lib/sanity/content.js";

// Preparation connection only. Existing app reads/writes do not route here yet.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!requireAdmin(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { type, id, offset } = req.query || {};
    if (type === undefined) return res.status(200).json(await contentStatus());
    validateContentType(type);
    if (id !== undefined) {
      validateContentId(id);
      const document = await readContent(type, id);
      return document ? res.status(200).json({ document }) : res.status(404).json({ error: "Content not found" });
    }
    return res.status(200).json({ documents: await listContent(type, contentPage(offset)), limit: 50 });
  } catch (error) {
    if (error.code === "SANITY_NOT_CONFIGURED") return res.status(503).json({ error: error.message });
    if (error.status === 400) return res.status(400).json({ error: error.message });
    // Never return upstream requests, credentials, or private query responses.
    return res.status(502).json({ error: "Sanity content is unavailable. Check server credentials and connectivity." });
  }
}
