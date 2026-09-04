// Shared-secret auth for the /api/admin/* endpoints. The admin page sends
// the secret back as a header on every request; compared in constant time
// so response timing can't be used to guess it character by character.

import { timingSafeEqual, createHmac } from "node:crypto";

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

// --- Short-lived view tokens ---
//
// The letter page opens in a new tab, where sessionStorage from the admin page
// isn't available. Rather than move the secret to localStorage (which would
// outlive the browser session) or put it in a URL, the admin page asks for a
// signed token scoped to one job and valid for a few minutes.

const TOKEN_TTL_MS = 15 * 60 * 1000;

function sign(payload) {
  return createHmac("sha256", process.env.ADMIN_SECRET || "")
    .update(payload)
    .digest("base64url");
}

export function makeViewToken(jobId) {
  const exp = Date.now() + TOKEN_TTL_MS;
  return `${exp}.${sign(`${jobId}.${exp}`)}`;
}

export function verifyViewToken(jobId, token) {
  if (!process.env.ADMIN_SECRET || !jobId || typeof token !== "string") return false;
  const [expRaw, mac] = token.split(".");
  const exp = Number(expRaw);
  if (!exp || !mac || Date.now() > exp) return false;
  const expected = sign(`${jobId}.${exp}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
