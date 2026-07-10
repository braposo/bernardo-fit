import { runAnalysis } from "./_analyze.js";
import { saveReport, findReportByHash, checkAndCountRate } from "./_store.js";

// Pull the client IP from common proxy headers (Vercel/Netlify set these).
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

// POST /api/analyze  { jobDescription: string }
// 1) If this exact JD was analysed before, return the existing report (no cost, no rate hit).
// 2) Otherwise enforce a per-IP rate limit, then run + store a fresh analysis.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { jobDescription } = req.body || {};
    if (!jobDescription || jobDescription.trim().length < 20) {
      res.status(400).json({ error: "Please paste a fuller job description." });
      return;
    }
    const jd = jobDescription.trim();

    // 1) Dedup — same JD returns the same permalink, free.
    const existing = await findReportByHash(jd);
    if (existing) {
      res.status(200).json({ id: existing.id, report: existing.report, cached: true });
      return;
    }

    // 2) Rate limit new analyses only (10/hour per IP by default).
    const rate = await checkAndCountRate(clientIp(req), 10, 3600);
    if (!rate.allowed) {
      const mins = Math.ceil(rate.resetInSeconds / 60);
      res.setHeader("Retry-After", String(rate.resetInSeconds));
      res.status(429).json({
        error: `That's a lot of analyses in a short time. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`,
      });
      return;
    }

    let report;
    try {
      report = await runAnalysis(jd);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, detail: err.detail });
      return;
    }

    report.job_description = jd;
    report.created_at = new Date().toISOString();

    const id = await saveReport(report);
    res.status(200).json({ id, report, cached: false });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 300) });
  }
}
