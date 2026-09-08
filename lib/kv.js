// One configuration boundary for HTTP handlers, workers and telemetry.
export const hasKV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

if (!hasKV && (process.env.VERCEL_ENV === "production" || process.env.REQUIRE_KV === "1")) {
  throw new Error("KV is not configured. Refusing to use in-memory storage in production or a persistent worker.");
}

export async function kv() {
  return (await import("@vercel/kv")).kv;
}
