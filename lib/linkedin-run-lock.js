// Durable waits release queue slots. Source ownership lasts until Trigger reports
// the owner terminal, rather than expiring mid-Retry-After on a wall-clock lease.
export async function claimLinkedInSource(client, runId, retrieveRun) {
  const key = 'linkedin-discovery:lock';
  if (await client.set(key, runId, { nx: true })) return true;
  const owner = await client.get(key);
  if (!owner) return !!await client.set(key, runId, { nx: true });
  if (owner === runId) return true;
  const run = await retrieveRun(owner); // Fail closed if Trigger status is unavailable.
  if (!run.isCompleted) return false;
  return !!await client.eval('if redis.call("get", KEYS[1]) == ARGV[1] then redis.call("set", KEYS[1], ARGV[2]); return 1 else return 0 end', [key], [owner, runId]);
}
