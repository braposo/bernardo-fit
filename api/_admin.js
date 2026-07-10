// Shared-secret auth for the /api/admin/* endpoints. The admin page sends
// the secret back as a header on every request; compared in constant time
// so response timing can't be used to guess it character by character.

import { timingSafeEqual } from "node:crypto";

function isAuthorized(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;

  const provided = req.headers["x-admin-secret"];
  if (!provided || typeof provided !== "string") return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Returns true if authorized; otherwise writes a 401 and returns false.
export function requireAdmin(req, res) {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}
