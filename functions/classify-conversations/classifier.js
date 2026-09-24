import { loadChatSettings } from './settings.js';
const probability = value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
export function metricsFromAnswers(data, settings) {
  if (data?.model !== settings.classifierModel) throw new Error("Jev returned an unsupported classifier model");
  for (const [key, question] of Object.entries(settings.questions)) {
    const answer = data.answers?.[key];
    if (!answer || answer.type !== question.type || (answer.confidence != null && !probability(answer.confidence))) throw new Error("Invalid Jev classification");
    if (question.type === "noul") {
      if (!probability(answer.noul)) throw new Error("Invalid Jev gap probability");
    } else {
      const keys = question.type === "score" ? question.criteria.map((_, i) => String(i)) : Object.keys(question.criteria);
      if (!answer.probabilities || keys.some(k => !probability(answer.probabilities[k])) ||
          Math.abs(keys.reduce((sum, k) => sum + answer.probabilities[k], 0) - 1) > 0.02) throw new Error("Invalid Jev probability distribution");
      if (question.type === "choice" && !keys.includes(answer.choice)) throw new Error("Invalid Jev sentiment");
      if (question.type === "score" && (typeof answer.score !== "number" || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > 9)) throw new Error("Invalid Jev success score");
    }
  }
  return { successScore: Math.round(data.answers.success.score) + 1, sentiment: data.answers.sentiment.choice,
    contentGaps: Object.entries(settings.gaps).filter(([key]) => data.answers[key].noul >= settings.gapThreshold).map(([, label]) => label) };
}

export async function classifyWithJev(messages, { apiKey = process.env.TYPESAFE_API_KEY, fetchImpl = fetch, settings } = {}) {
  if (!apiKey?.trim()) throw new Error("Jev classifier credential is missing");
  settings ||= await loadChatSettings();
  const body = JSON.stringify({ model: settings.classifierModel, state: { messages }, questions: settings.questions });
  if (Buffer.byteLength(body) > 100000) throw new Error("Conversation exceeds Jev classification limit");
  const response = await fetchImpl("https://api.typesafe.ai/v1/systemone", { method: "POST",
    headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" },
    body, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("Jev classification request failed");
  return metricsFromAnswers(await response.json(), settings);
}

export async function classifyPending(client, classify = classifyWithJev) {
  const pending = await client.context.fetch(`*[_type == "sanity.context.conversation" && organizationId == $org
    && !defined(classifiedAt) && !defined(classificationError) && count(messages) > 0
    && messagesUpdatedAt < $before && $endpoint in metadata.mcpEndpoints]
    | order(messagesUpdatedAt asc)[0...3]{threadId}`, {
    org: client.config().context.organizationId, endpoint: "bernardo-fit-admin",
    before: new Date(Date.now() - 10 * 60000).toISOString(),
  });
  let successCount = 0, errorCount = 0;
  for (const { threadId } of pending) {
    try {
      const conversation = await client.context.conversations.get({ threadId });
      if (!conversation?.messages?.length) throw new Error("Empty conversation");
      const coreMetrics = await classify(conversation.messages);
      await client.context.conversations.classify({ threadId, coreMetrics });
      successCount++;
    } catch {
      errorCount++;
      // Stable safe errors; no transcript/provider error body in stored diagnostics.
      await client.context.conversations.classify({ threadId, classificationError: "Jev classification failed (jev-insights-1). Review and retry explicitly." });
    }
  }
  return { successCount, errorCount, totalFound: pending.length };
}
