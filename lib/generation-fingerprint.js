import { createHash } from "node:crypto";

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function coverFingerprint(job, report, model) {
  return digest({
    jobId: job.id,
    reportId: job.fitReportId,
    report: digest(report),
    instructions: String(job.instructions || "").trim(),
    model,
  });
}
