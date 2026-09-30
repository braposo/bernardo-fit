import { loadChatSettings } from './settings.js';
const failure = (message, retryable = false) => Object.assign(new Error(message), { retryable });
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

export async function classifyWithJev(messages, { apiKey = process.env.TYPESAFE_API_KEY, fetchImpl = fetch, settings, signal } = {}) {
  if (!apiKey?.trim()) throw failure("Jev classifier credential is missing");
  settings ||= await loadChatSettings();
  const body = JSON.stringify({ model: settings.classifierModel, state: { messages }, questions: settings.questions });
  if (Buffer.byteLength(body) > 100000) throw failure("Conversation exceeds Jev classification limit");
  let response;
  try {
    response = await fetchImpl("https://api.typesafe.ai/v1/systemone", { method: "POST",
      headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" },
      body, signal: signal || AbortSignal.timeout(30000) });
  } catch (error) { throw failure('Jev classification transport failed', error?.retryable !== false && !error?.abort); }
  if (!response.ok) throw failure('Jev classification request failed', response.status === 429 || response.status >= 500);
  try { return metricsFromAnswers(await response.json(), settings); }
  catch { throw failure('Invalid Jev classification response'); }
}

export function classificationPayload(value) {
  if (!value || typeof value.threadId !== 'string' || !value.threadId.startsWith('admin-chat.') || value.threadId.length > 200)
    throw failure('Invalid classification snapshot ID');
  return { threadId: value.threadId };
}

async function storageOperation(operation) {
  try { return await operation(); }
  catch (error) {
    const status = error?.statusCode;
    throw failure('Insights storage request failed', !status || status === 429 || status >= 500);
  }
}

export async function classifyConversation(client, { threadId }, {
  classify = classifyWithJev, loadSettings = loadChatSettings, retryStage = operation => operation(),
} = {}) {
  const conversation = await retryStage(() => storageOperation(() => client.context.conversations.get({ threadId })));
  if (!conversation) return { status: 'missing' };
  // A late duplicate, or replay after an ambiguous write, must not pay for Jev again.
  if (conversation.classifiedAt || conversation.classificationError) return { status: 'skipped' };
  if (!conversation.metadata?.mcpEndpoints?.includes('bernardo-fit-admin')) throw failure('Snapshot is outside admin chat');
  if (!conversation.messages?.length) throw failure('Empty conversation');
  const settings = await retryStage(async () => {
    try { return await loadSettings(); }
    catch (error) { throw failure('Chat settings could not be loaded', error?.code !== 'CHAT_SETTINGS_INVALID'); }
  });
  const coreMetrics = await retryStage(() => classify(conversation.messages, { settings }));
  // Retry the write independently, retaining the successful paid result in memory.
  await retryStage(() => storageOperation(() => client.context.conversations.classify({ threadId, coreMetrics })));
  return { status: 'classified', settingsRevision: settings.revision };
}

export async function recordClassificationFailure(client, payload) {
  const { threadId } = classificationPayload(payload);
  const conversation = await storageOperation(() => client.context.conversations.get({ threadId }));
  if (!conversation || conversation.classifiedAt || conversation.classificationError ||
      !conversation.metadata?.mcpEndpoints?.includes('bernardo-fit-admin')) return;
  await storageOperation(() => client.context.conversations.classify({ threadId,
    classificationError: 'Jev classification failed (jev-insights-2). Review the Trigger run and retry explicitly.',
  }));
}
