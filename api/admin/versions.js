import { requireAdmin } from "../../lib/admin.js";
import {
  getJob,
  getReport,
  mutateJob,
  listReportVersions,
  activateReportVersion,
} from "../../lib/store.js";
import { getCoverArtifact, listCoverVersions, migrateLegacyCoverArtifacts } from "../../lib/cover-artifacts.js";
import { applyAnalysisToOwners } from "../../lib/analysis-completion.js";
import { getScreenArtifact, listScreenArtifacts } from "../../lib/screen-artifacts.js";

// GET  /api/admin/versions?id=<jobId>          list both kinds for one row
// POST /api/admin/versions { id, kind, vid }   make one of them live
//
// Fetched on demand rather than folded into the jobs list, which would mean an
// extra read per row on every page load to serve something usually unopened.
//
// The full report and letter bodies are deliberately left out of the listing.
// A row can hold several of each, and sending them all just to render a few
// dates would be a large response for nothing.
function meta(v, kind) {
  const instructions = { versionInstructions: v.versionInstructions || "" };
  if (kind === "fit") return { ...instructions, vid: v.vid, at: v.createdAt, model: v.model || "", active: !!v.active,
    score: v.internal ? v.internal.score : null };
  if (kind === "letter") return { ...instructions, vid: v.vid, at: v.at, model: v.model || "", active: !!v.active,
    words: v.words || 0, salutation: v.salutation || "" };
  return { ...instructions, vid: v.id, at: v.at, model: v.model || "", active: false,
    ...(kind === "research" ? { sources: (v.sources || []).length, partial: !!v.partial } : {}) };
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  res.setHeader("Cache-Control", "private, no-store");

  try {
    if (req.method === "GET") {
      const { id } = req.query || {};
      if (!id) {
        res.status(400).json({ error: "Missing id" });
        return;
      }
      const job = await getJob(id);
      if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
      }
      if (req.query.kind) {
        const { kind, vid } = req.query;
        let artifact;
        if (kind === "fit") {
          artifact = vid ? (await listReportVersions(job.fitReportId)).find(v => v.vid === vid)?.report
            : await getReport(job.fitReportId);
        } else if (kind === "letter") {
          artifact = await getCoverArtifact(job.id, vid);
          if (!artifact) artifact = (job.coverLetterVersions || []).find(v => v.vid === vid);
        } else if (kind === "brief" || kind === "research") {
          artifact = await getScreenArtifact(kind, job.id, vid);
        } else return res.status(400).json({ error: "Unknown version kind" });
        if (!artifact) return res.status(404).json({ error: "Version not found" });
        const fields = kind === "fit" ? ["job_title", "company", "pitch", "categories", "differentiators", "closing"]
          : kind === "letter" ? ["salutation", "paragraphs"]
          : kind === "research" ? ["summary", "signals", "risks", "roleContext", "unknowns", "sources"]
          : ["contact", "opening", "why", "conversation", "likelyQuestions", "gapResponses", "greenFlags", "redFlags", "questionsToAsk", "companyReference", "roleReference", "personalAnswers", "unknowns", "sources"];
        return res.status(200).json({ content: Object.fromEntries(fields.filter(key => artifact[key] !== undefined).map(key => [key, artifact[key]])) });
      }
      let fit = job.fitReportId ? await listReportVersions(job.fitReportId) : [];
      // Analyses generated before versioning existed have no version list.
      // Rather than show an empty panel next to a live report, describe the
      // live one. There is nothing to switch to, so it needs no vid.
      if (!fit.length && job.fitReportId) {
        const live = await getReport(job.fitReportId);
        if (live) {
          fit = [{
            vid: "",
            createdAt: live.regenerated_at || live.created_at || "",
            model: live.model || "",
            active: true,
            internal: job.score != null ? { score: job.score } : null,
          }];
        }
      }
      const [research, brief] = await Promise.all([listScreenArtifacts(job.id, "research"), listScreenArtifacts(job.id, "brief")]);
      res.status(200).json({
        fit: fit.map((v) => meta(v, "fit")),
        letter: (await listCoverVersions(job)).map((v) => meta(v, "letter")),
        research: research.map((v) => ({ ...meta(v, "research"), active: v.id === job.researchId })),
        brief: brief.map((v) => ({ ...meta(v, "brief"), active: v.id === job.briefId })),
      });
      return;
    }

    if (req.method === "POST") {
      const { id, kind, vid } = req.body || {};
      if (!id || !vid || !["fit", "letter", "research", "brief"].includes(kind)) {
        res.status(400).json({ error: "Missing id, vid, or kind" });
        return;
      }
      const job = await getJob(id);
      if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
      }

      if (kind === "fit") {
        if (!job.fitReportId) {
          res.status(409).json({ error: "No analysis for this role yet." });
          return;
        }
        const report = await activateReportVersion(job.fitReportId, vid);
        if (!report) {
          res.status(404).json({ error: "Version not found" });
          return;
        }
        // The row's score belongs to whichever analysis is live, so move it back
        // with the version. Older versions saved before scores were snapshotted
        // have none, and the row keeps what it had rather than being blanked.
        const versions = await listReportVersions(job.fitReportId);
        const chosen = versions.find((v) => v.vid === vid);
        await applyAnalysisToOwners(job.fitReportId, chosen?.internal || null);
        res.status(200).json({ ok: true, kind, vid });
        return;
      }

      if (kind === "research" || kind === "brief") {
        const artifact = await getScreenArtifact(kind, job.id, vid);
        if (!artifact) return res.status(404).json({ error: "Version not found" });
        await mutateJob(id, () => kind === "research" ? {
          researchId: artifact.id, researchAt: artifact.at || "", researchModel: artifact.model || "",
          researchSourceCount: (artifact.sources || []).length, researchPartial: !!artifact.partial,
          researchFingerprint: "", briefFingerprint: "", researchRun: null,
        } : {
          briefId: artifact.id, briefAt: artifact.at || "", briefModel: artifact.model || "",
          briefStage: artifact.stage || "screen", briefFingerprint: "", briefRun: null, prepareRun: null,
        });
        return res.status(200).json({ ok: true, kind, vid });
      }

      await migrateLegacyCoverArtifacts(job);
      const available = await listCoverVersions(job);
      const chosen = await getCoverArtifact(job.id, vid);
      if (!chosen) {
        res.status(404).json({ error: "Version not found" });
        return;
      }
      await mutateJob(id, (current) => {
        return {
          coverLetterId: chosen.vid,
          coverLetter: null,
          coverLetterAt: chosen.at,
          coverLetterModel: chosen.model,
          coverLetterSalutation: chosen.salutation || "",
          coverLetterWords: chosen.words || 0,
          coverLetterVersionCount: Math.max(Number(current.coverLetterVersionCount) || 0, available.length),
          coverLetterVersions: [],
          coverRun: null,
        };
      });
      res.status(200).json({ ok: true, kind, vid });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : "Unexpected error", detail: String(err).slice(0, 300) });
  }
}
