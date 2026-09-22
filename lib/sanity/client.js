// Server-only: import this module from api/, lib/, or workers, never browser code.
import { createClient } from "@sanity/client";

export const SANITY_PROJECT_ID = "quli96gc";
export const SANITY_DATASET = "production";
export const SANITY_API_VERSION = "2026-09-22";

export function sanityConfigured(env = process.env) {
  return !!env.SANITY_READ_TOKEN;
}

export function createContentClient(env = process.env) {
  if (typeof window !== "undefined") throw new Error("Sanity content is server-only.");
  if (!sanityConfigured(env)) {
    throw Object.assign(new Error("Set SANITY_READ_TOKEN to connect the private Sanity dataset."), {
      code: "SANITY_NOT_CONFIGURED", status: 503,
    });
  }
  return createClient({
    projectId: SANITY_PROJECT_ID,
    dataset: SANITY_DATASET,
    apiVersion: SANITY_API_VERSION,
    token: env.SANITY_READ_TOKEN,
    perspective: "published",
    useCdn: false,
    timeout: 10000,
    maxRetries: 1,
  });
}
