// One configuration boundary for HTTP handlers, workers and telemetry.
export const hasKV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

if (!hasKV && (process.env.VERCEL_ENV === "production" || process.env.REQUIRE_KV === "1")) {
  throw new Error("KV is not configured. Refusing to use in-memory storage in production or a persistent worker.");
}

export async function kv() {
  const client = (await import("@vercel/kv")).kv;
  return namespaceKV(client, process.env.KV_NAMESPACE || '');
}

// Preview content uses separate coordination keys even when the Redis service
// is shared with production. Stored values (including IDs) are never rewritten.
export function namespaceKV(client, namespace) {
  if (!namespace) return client;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(namespace)) throw new Error('Invalid KV_NAMESPACE');
  const key = value => `${namespace}:${value}`;
  let proxy;
  proxy = new Proxy(client, {get(target, method) {
    const original=target[method];
    if(typeof original!=='function')return original;
    if(method==='pipeline' || method==='multi')return (...args)=>namespaceKV(original.apply(target,args),namespace);
    if(method==='exec')return (...args)=>original.apply(target,args);
    return (...args)=>{
      if(method==='eval' || method==='evalsha') args[1]=args[1].map(key);
      else if(['del','mget','exists','unlink'].includes(method)) args=args.map(key);
      else if(/^(get|set|incr|decr|expire|ttl|persist|hgetall|hget|hset|hsetnx|hincrby|hdel|lpush|rpush|lrange|ltrim|sadd|srem|smembers|scard|zadd|zrange|zrem|zcard|zscore|zcount|zremrangebyscore)$/.test(String(method))) args[0]=key(args[0]);
      else throw new Error(`Unsupported namespaced KV operation: ${String(method)}`);
      const result=original.apply(target,args);return result===target?proxy:result;
    };
  }});
  return proxy;
}
