import { buildSystemPrompt } from "./_profile.js";
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

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY." });
      return;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 2000,
        system: buildSystemPrompt(),
        messages: [
          {
            role: "user",
            content: `Here's the job description. Write my fit analysis:\n\n${jd}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      res.status(502).json({ error: "Analysis service error", detail: text.slice(0, 500) });
      return;
    }

    const data = await response.json();
    const raw = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    let clean = raw.replace(/```json|```/g, "").trim();
    const first = clean.indexOf("{");
    const last = clean.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      clean = clean.slice(first, last + 1);
    }
    let report;
    try {
      report = JSON.parse(clean);
    } catch {
      console.error("Failed to parse model output as JSON:", raw);
      res.status(502).json({ error: "Could not parse the analysis. Try again." });
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
