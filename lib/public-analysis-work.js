import { analysisContext, runAnalysis } from "./analyze.js";
import { PUBLIC_MODEL } from "./models.js";
import { publicAnalysisFingerprint } from "./public-analysis.js";
import { getTaskInput } from "./task-results.js";
import {
  createJobIfAbsent, findJobForReport, findReportByHash, getReport, listReportVersions,
  mutateJob, saveReportWithId,
} from "./store.js";

async function activeInternal(reportId) {
  return (await listReportVersions(reportId)).find((version) => version.active)?.internal || null;
}

export async function linkPublicAnalysisToPipeline(reportId, report, jd, internal) {
  try {
    const scoring = internal ? {
      score: internal.score, tier: internal.tier,
      scoreBreakdown: internal.breakdown, rationale: internal.reasoning,
    } : {};
    const existing = await findJobForReport(reportId, jd);
    if (existing) {
      await mutateJob(existing.id, (current) => ({
        ...(current.fitReportId ? {} : { fitReportId: reportId }), ...scoring,
      }));
      return existing.id;
    }
    const id = `pub_${reportId}`;
    await createJobIfAbsent(id, {
      company: report.company || "", role: report.job_title || "Untitled role",
      source: "Analysed on the website", sourceType: "website", jobDescription: jd,
      fitReportId: reportId, stage: "new", receivedAt: new Date().toISOString(), ...scoring,
    });
    return id;
  } catch (error) {
    console.error("Failed to link public analysis to pipeline:", String(error).slice(0, 200));
    return null;
  }
}

export async function executePublicAnalysisWork({ requestId, inputId, fingerprint }) {
  const jd = String(await getTaskInput("public-analysis", inputId) || "").trim();
  if (jd.length < 20 || publicAnalysisFingerprint(jd) !== fingerprint) {
    throw Object.assign(new Error("Public analysis input is missing or changed."), { abort: true, status: 409 });
  }
  const cached = await findReportByHash(jd, { model: PUBLIC_MODEL, generation: analysisContext() });
  if (cached) {
    await linkPublicAnalysisToPipeline(cached.id, cached.report, jd, await activeInternal(cached.id));
    return { outcome: "completed", requestId, reportId: cached.id, cached: true };
  }
  const recovered = await getReport(requestId);
  if (recovered) {
    await linkPublicAnalysisToPipeline(requestId, recovered, jd, await activeInternal(requestId));
    return { outcome: "completed", requestId, reportId: requestId, cached: false };
  }
  const generated = await runAnalysis(jd, { model: PUBLIC_MODEL, ref: requestId });
  generated.report.job_description = jd;
  generated.report.created_at = new Date().toISOString();
  generated.report.model = PUBLIC_MODEL;
  await saveReportWithId(requestId, generated.report, generated.internal);
  await linkPublicAnalysisToPipeline(requestId, generated.report, jd, generated.internal);
  return { outcome: "completed", requestId, reportId: requestId, cached: false };
}
