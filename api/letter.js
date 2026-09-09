import { verifyViewToken } from "../lib/admin.js";
import { getJob } from "../lib/store.js";
import { getActiveCoverArtifact } from "../lib/cover-artifacts.js";
import { getActiveBrief, getActiveResearch } from "../lib/screen-artifacts.js";

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
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");

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
    const kind = String(req.query?.kind || "cover");
    if (kind === "brief" || kind === "research") {
      const artifact = kind === "research" ? await getActiveResearch(job) : await getActiveBrief(job);
      if (!job || !artifact) return res.status(404).json({ error: `No ${kind} for this role yet.` });
      return res.status(200).json({ kind, company: job.company || "", role: job.role || "", artifact });
    }
    const letter = await getActiveCoverArtifact(job);
    if (!job || !letter) {
      res.status(404).json({ error: "No cover letter for this role yet." });
      return;
    }
    res.status(200).json({
      company: job.company || "",
      role: job.role || "",
      paragraphs: letter.paragraphs,
      generatedAt: letter.at || "",
      salutation: letter.salutation || "",
      words: letter.words || 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Unexpected error", detail: String(err).slice(0, 200) });
  }
}
