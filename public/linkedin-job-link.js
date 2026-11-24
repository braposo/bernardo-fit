// The LinkedIn posting ID in a pasted or shared job link, for the admin's
// search box and the server alike. Accepts the forms LinkedIn shares:
// /jobs/view/123, /jobs/view/engineering-manager-at-acme-123, /comm/jobs/view/123,
// and search or collection pages with ?currentJobId=123 (any linkedin.com
// subdomain, with or without https://, or inside a line of shared text).
// Anything else returns "".
const LINKEDIN_HOST = /^(?:[a-z0-9-]+\.)?linkedin\.com$/i;

export function linkedInJobId(input) {
  const text = String(input || "").trim();
  const candidate = text.match(/https?:\/\/[^\s<>"']+/i)?.[0] ||
    text.match(/(?:^|\s)((?:[a-z0-9-]+\.)?linkedin\.com\/[^\s<>"']+)/i)?.[1]?.replace(/^/, "https://") || "";
  if (!candidate) return "";
  let url;
  try { url = new URL(candidate); } catch (_) { return ""; }
  if (!/^https?:$/.test(url.protocol) || !LINKEDIN_HOST.test(url.hostname)) return "";
  const view = url.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,20})\/?$/i);
  if (view) return view[1];
  const current = url.searchParams.get("currentJobId") || "";
  return /\/jobs\//i.test(url.pathname) && /^\d{6,20}$/.test(current) ? current : "";
}

export const linkedInJobUrl = id => "https://www.linkedin.com/jobs/view/" + id;
