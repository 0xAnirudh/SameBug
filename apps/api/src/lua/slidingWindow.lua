-- Sliding-window log rate limiter.
--
-- The check and the increment must be one operation. Two concurrent requests
-- that both read "9 of 10" would both proceed; a Lua script runs atomically
-- inside Redis, which is the entire reason this is not three round trips.
--
-- KEYS[1] = window key
-- ARGV[1] = now in ms, ARGV[2] = window ms, ARGV[3] = limit, ARGV[4] = unique id
-- returns  { allowed (1/0), used, resetMs }

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))

local used = redis.call('ZCARD', KEYS[1])
local limit = tonumber(ARGV[3])

if used >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local resetMs = tonumber(ARGV[2])
  if oldest[2] then
    resetMs = (tonumber(oldest[2]) + tonumber(ARGV[2])) - tonumber(ARGV[1])
  end
  return { 0, used, resetMs }
end

redis.call('ZADD', KEYS[1], ARGV[1], ARGV[1] .. '-' .. ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[2])

return { 1, used + 1, tonumber(ARGV[2]) }
