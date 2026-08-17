import { trackEvent } from "./_store.js";

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
