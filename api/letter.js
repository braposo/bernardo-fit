import { verifyViewToken } from "./_admin.js";
import { getJob } from "./_store.js";

// GET /api/letter?j=<jobId>&t=<token>
//
// Feeds the printable letter page. Gated by a short-lived signed token rather
// than the admin secret, so opening the letter in a new tab doesn't require
// persisting the secret anywhere a new tab could read it.
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { j, t } = req.query || {};
  if (!j || !t) {
    res.status(400).json({ error: "Missing job or token" });
    return;
  }
  if (!verifyViewToken(j, t)) {
    res.status(401).json({ error: "This link has expired. Open it again from the dashboard." });
    return;
  }

  try {
    const job = await getJob(j);
    if (!job || !job.coverLetter) {
      res.status(404).json({ error: "No cover letter for this role yet." });
      return;
    }
    res.status(200).json({
      company: job.company || "",
      role: job.role || "",
      paragraphs: job.coverLetter,
      generatedAt: job.coverLetterAt || "",
    });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 200) });
  }
}
