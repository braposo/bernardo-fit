import { AsyncLocalStorage } from "node:async_hooks";

// Workers add attribution without putting Trigger SDK imports into HTTP bundles.
const context = new AsyncLocalStorage();
export const withGenerationContext = (value, run) => context.run(value, run);
export const generationContext = () => context.getStore() || {};

export function generationEffort(kind, fallback = "high") {
  const value = process.env[`AI_${String(kind || "").toUpperCase()}_EFFORT`];
  return ["low", "medium", "high"].includes(value) ? value : fallback;
}
