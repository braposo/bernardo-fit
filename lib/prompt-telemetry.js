import { createHash } from "node:crypto";

// Prompt text stays in Sanity. Only a digest of the stable instructions or
// question rubric is sent to Trigger; request-specific context is excluded.
export function promptIdentity(kind, source, revision) {
  const slug = `fit-${String(kind || "unknown").replace(/[^a-z0-9-]/gi, "-").toLowerCase()}`;
  const fingerprint = createHash("sha256").update(JSON.stringify(source)).digest("hex");
  // Trigger's llm_metrics.prompt_version is UInt32. Keep the full digest too
  // so versions remain unambiguous if the short numeric identifier collides.
  const version = parseInt(fingerprint.slice(0, 8), 16) || 1;
  return { slug, version, fingerprint, revision: revision || "code-baseline" };
}

export function setPromptAttributes(attribute, prompt) {
  if (!prompt) return;
  for (const [name, value] of Object.entries(promptSpanAttributes(prompt))) attribute(name, value);
}

export function promptTelemetryMetadata(prompt) {
  return {
    "prompt.slug": prompt.slug,
    "prompt.version": String(prompt.version),
    "fit.ai.prompt.fingerprint": prompt.fingerprint,
    "fit.ai.prompt.revision": prompt.revision,
  };
}

export function promptSpanAttributes(prompt) {
  return {
    "prompt.slug": prompt.slug,
    "prompt.version": prompt.version,
    "fit.ai.prompt.fingerprint": prompt.fingerprint,
    "fit.ai.prompt.revision": prompt.revision,
    ...Object.fromEntries(Object.entries(promptTelemetryMetadata(prompt)).map(([key, value]) =>
      [`ai.telemetry.metadata.${key}`, value])),
  };
}

export function chatPromptSpanAttributes({ spanType, runtimeContext }) {
  const prompt = runtimeContext?.promptTelemetry;
  return spanType === "languageModel" && prompt ? promptSpanAttributes(prompt) : {};
}
