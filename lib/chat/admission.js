import { hasKV, kv } from "../kv.js";
import { chatError } from "./policy.js";

const leases = new Map();
let bucket = "", count = 0;
const ADMIT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= 2 then return 0 end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= 60 then return 0 end
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], 3700)
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('EXPIRE', KEYS[1], 240)
return 1`;

export async function admitChat(id, now = Date.now()) {
  const hour = new Date(now).toISOString().slice(0,13);
  let accepted;
  if (hasKV) {
    accepted = Number(await (await kv()).eval(ADMIT, ["chat:active", `chat:hour:${hour}`], [now, now + 240000, id])) === 1;
  } else {
    for (const [key, expiry] of leases) if (expiry <= now) leases.delete(key);
    if (bucket !== hour) { bucket = hour; count = 0; }
    accepted = leases.size < 2 && count < 60;
    if (accepted) { leases.set(id, now + 240000); count++; }
  }
  if (!accepted) throw chatError("Chat is busy or its hourly limit has been reached. Try again later.", 429, "CHAT_RATE_LIMIT");
  return async () => {
    if (hasKV) await (await kv()).zrem("chat:active", id);
    else leases.delete(id);
  };
}
