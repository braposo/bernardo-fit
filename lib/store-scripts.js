// Kept as exported constants so integration tests execute the actual Lua.
// Every writer of a job goes through this compare-and-set, including deletes.
export const JOB_WRITE = `
if ARGV[5] ~= '' and tonumber(redis.call('GET', KEYS[4]) or '0') ~= tonumber(ARGV[5]) then return -1 end
local current = redis.call('GET', KEYS[1])
local revision = current and (cjson.decode(current).revision or 0) or -1
if revision ~= tonumber(ARGV[1]) then return 0 end
if ARGV[2] == '' then
  if current then
    local report = cjson.decode(current).fitReportId
    if report and report ~= '' then redis.call('SADD', KEYS[3], report) end
  end
  redis.call('DEL', KEYS[1])
  redis.call('ZREM', KEYS[2], ARGV[4])
else
  redis.call('SET', KEYS[1], ARGV[2])
  redis.call('ZADD', KEYS[2], ARGV[3], ARGV[4])
end
return 1
`;

// Report, version history, source metadata and reuse indexes change together.
export const REPORT_WRITE = `
if tonumber(redis.call('GET', KEYS[3]) or '0') ~= tonumber(ARGV[1]) then return 0 end
for i = 6, 7 do
  if redis.call('GET', KEYS[i]) == ARGV[5] then redis.call('DEL', KEYS[i]) end
end
if ARGV[2] == '' then
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[4])
  redis.call('ZREM', KEYS[5], ARGV[5])
else
  redis.call('SET', KEYS[1], ARGV[2])
  redis.call('SET', KEYS[2], ARGV[3])
  redis.call('SET', KEYS[4], ARGV[6])
  redis.call('ZADD', KEYS[5], ARGV[4], ARGV[5])
  redis.call('SET', KEYS[8], ARGV[5])
  redis.call('SET', KEYS[9], ARGV[5])
end
redis.call('INCR', KEYS[3])
return 1
`;

// Cover bodies use deterministic per-version keys. This script protects the
// small metadata index so concurrent drafts cannot drop one another.
export const COVER_INDEX_WRITE = `
if tonumber(redis.call('GET', KEYS[2]) or '0') ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('INCR', KEYS[2])
return 1
`;
