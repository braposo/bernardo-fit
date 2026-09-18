import { trackEvent } from "../lib/store.js";
import { verifyViewToken } from "../lib/admin.js";
import { appendAudit, auditEvent } from "../lib/job-audit.js";

// POST /api/track  { id, event }
//
// Public, unauthenticated, and deliberately minimal. It increments a counter
// for a saved report and records first/last seen. Nothing identifying the
// visitor is stored: no IP, no user agent, no fingerprint. It exists so I can
// tell whether a link I shared was opened, not who opened it.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { id, event } = req.body || {};
    if (event === "document_print") {
      const { token, kind } = req.body || {};
      if (typeof id !== "string" || !verifyViewToken(id, token) || !["cover", "research", "brief"].includes(kind)) return res.status(400).json({ error: "Invalid document event" });
      await appendAudit("job", id, auditEvent("document.print", `${{ cover: "Cover letter", research: "Company research", brief: "Interview brief" }[kind]} print dialog opened`, "Printing or saving a PDF was requested; completion is not observable.", { actor: "admin" }));
      return res.status(204).end();
    }
    const ok = await trackEvent(id, event);
    if (!ok) {
      res.status(400).json({ error: "Bad id or event" });
      return;
    }
    // 204 keeps the response empty; the page doesn't need anything back.
    res.status(204).end();
  } catch {
    // Never let analytics failures surface to a visitor.
    res.status(204).end();
  }
}
