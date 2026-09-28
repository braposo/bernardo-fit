import { tasks, idempotencyKeys } from '@trigger.dev/sdk';

export const CLASSIFICATION_TASK_ID = 'classify-chat-conversation';

export async function dispatchPending(client, trigger = tasks.trigger) {
  const pending = await client.context.fetch(`*[_type == "sanity.context.conversation" && organizationId == $org
    && !defined(classifiedAt) && !defined(classificationError) && count(messages) > 0
    && messagesUpdatedAt < $before && $endpoint in metadata.mcpEndpoints]
    | order(messagesUpdatedAt asc)[0...3]{threadId}`, {
    org: client.config().context.organizationId, endpoint: 'bernardo-fit-admin',
    before: new Date(Date.now() - 10 * 60000).toISOString(),
  });
  let dispatched = 0, failed = 0;
  const runIds = [];
  for (const { threadId } of pending) {
    try {
      const idempotencyKey = await idempotencyKeys.create([CLASSIFICATION_TASK_ID, client.config().context.organizationId, threadId], { scope: 'global' });
      const handle = await trigger(CLASSIFICATION_TASK_ID, { threadId }, {
        idempotencyKey, idempotencyKeyTTL: '30d',
      });
      runIds.push(handle.id);
      dispatched++;
    } catch {
      // Acceptance failures leave the snapshot pending for the next hourly run.
      failed++;
    }
  }
  return { dispatched, failed, found: pending.length, runIds };
}
