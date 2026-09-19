import { analysisContext, runAnalysis } from "./analyze.js";
import { PUBLIC_MODEL } from "./models.js";
import { publicAnalysisFingerprint } from "./public-analysis.js";
import { getTaskInput } from "./task-results.js";
import { selectWritingModel } from "./jev-model-routing.js";
import {
  createJobIfAbsent, findJobForReport, findReportByHash, getReport,
  mutateJob, saveReportWithId,
} from "./store.js";

export async function linkPublicAnalysisToPipeline(reportId, report, jd) {
  try {
    const existing = await findJobForReport(reportId, jd);
    if (existing) {
      await mutateJob(existing.id, (current) => ({
        ...(current.fitReportId ? {} : { fitReportId: reportId }),
      }));
      return existing.id;
    }
    const id = `pub_${reportId}`;
    await createJobIfAbsent(id, {
      company: report.company || "", role: report.job_title || "Untitled role",
      source: "Analysed on the website", sourceType: "website", jobDescription: jd,
      fitReportId: reportId, stage: "new", receivedAt: new Date().toISOString(),
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
  const recovered = await getReport(requestId);
  if (recovered) {
    await linkPublicAnalysisToPipeline(requestId, recovered, jd);
    return { outcome: "completed", requestId, reportId: requestId, cached: false };
  }
  const { model } = await selectWritingModel({ kind: "analyse", job: { id: requestId, jobDescription: jd }, fallback: PUBLIC_MODEL });
  const cached = await findReportByHash(jd, { model, generation: analysisContext() });
  if (cached) {
    await linkPublicAnalysisToPipeline(cached.id, cached.report, jd);
    return { outcome: "completed", requestId, reportId: cached.id, cached: true };
  }
  const generated = await runAnalysis(jd, { model, ref: requestId });
  generated.report.job_description = jd;
  generated.report.created_at = new Date().toISOString();
  generated.report.model = model;
  await saveReportWithId(requestId, generated.report, generated.internal);
  await linkPublicAnalysisToPipeline(requestId, generated.report, jd, generated.internal);
  return { outcome: "completed", requestId, reportId: requestId, cached: false };
}
