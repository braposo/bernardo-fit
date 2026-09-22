import { requireAdmin } from "../admin.js";
import { withAnalysisSettings } from "./analysis-settings.js";

export function withSettingsHandler(handler, { admin = true } = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    if (admin && !requireAdmin(req, res)) return;
    // Public status polling needs no prompts or candidate evidence.
    if (!admin && req.method !== "POST") return handler(req, res);
    try { return await withAnalysisSettings(() => handler(req, res)); }
    catch (error) {
      if (String(error.code || "").startsWith("SANITY_SETTINGS_")) {
        return res.status(503).json({ error: error.message, code: error.code });
      }
      throw error;
    }
  };
}
