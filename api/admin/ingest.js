import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { requireAdmin } from "../../lib/admin.js";
import { cleanOpportunity } from "../../lib/ingest-work.js";
import { digest } from "../../lib/generation-fingerprint.js";
import { getReceiptForRequest, saveRunReceipt } from "../../lib/run-receipts.js";
import { saveTaskInput } from "../../lib/task-results.js";
import { INGEST_TASK_ID } from "../../lib/task-policy.js";

const validRequestId = (value) => /^[a-zA-Z0-9_-]{8,100}$/.test(String(value || "")) ? String(value) : "";

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const list = req.body?.opportunities;
  const requestId = validRequestId(req.body?.requestId);
  if (!Array.isArray(list)) return res.status(400).json({ error: "Expected an opportunities array." });
  if (!requestId) return res.status(400).json({ error: "Expected a valid requestId." });
  if (list.length > 200) return res.status(400).json({ error: "Too many at once; send 200 or fewer." });
  try {
    const cleaned = list.map((row) => row && typeof row === "object" ? cleanOpportunity(row) : row);
    const recovered = await getReceiptForRequest("ingest", "batch", requestId);
    if (recovered) return res.status(202).json({ runId: recovered.runId, requestId, kind: "ingest", recovered: true });
    await saveTaskInput("ingest", requestId, cleaned);
    const key = await idempotencyKeys.create(`ingest:batch:${requestId}`, { scope: "global" });
    const handle = await tasks.trigger(INGEST_TASK_ID, { requestId }, {
      idempotencyKey: key, idempotencyKeyTTL: "30d", tags: ["batch:ingest", `request:${requestId}`],
    });
    await saveRunReceipt({ kind: "ingest", requestId, runId: handle.id, jobId: "batch", fingerprint: digest(cleaned) });
    return res.status(202).json({ runId: handle.id, requestId, kind: "ingest", recovered: false });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "Unexpected error", detail: String(error).slice(0, 300) });
  }
}
