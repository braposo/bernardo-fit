// Per-generation instructions are private metadata, never edits to the saved job.
export const MAX_VERSION_INSTRUCTIONS = 4000;
export function normaliseVersionInstructions(value) {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > MAX_VERSION_INSTRUCTIONS) {
    throw Object.assign(new Error("Version instructions must be text of at most 4000 characters."), { status: 400, abort: true });
  }
  return value.trim();
}
export function withVersionInstructions(job, value) {
  if (!job) return job;
  const extra = normaliseVersionInstructions(value);
  if (!extra || job._versionInstructions === extra) return job;
  return { ...job, _versionInstructions: extra,
    instructions: [String(job.instructions || "").trim(), "Additional instructions for this version:\n" + extra].filter(Boolean).join("\n\n") };
}
