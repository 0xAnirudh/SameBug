import { getRedis } from '../config/redis.js';
import { env } from '../config/env.js';

/**
 * Computing this from Mongo means an aggregation with a sort over a collection
 * that only grows. A sorted set is O(log N) to write and O(log N + M) to read,
 * and the hour bucket expires itself.
 */

const BUCKET_TTL_SECONDS = 2 * 60 * 60;

export function hourBucket(date = new Date()) {
  return `trending:${date.toISOString().slice(0, 13).replace(/[-T]/g, '')}`;
}

export async function recordHit(slug, now = new Date()) {
  if (!env.CACHE_ENABLED) return;

  const key = hourBucket(now);
  await getRedis().multi().zincrby(key, 1, slug).expire(key, BUCKET_TTL_SECONDS).exec();
}

/**
 * Reads the current hour and the one before it, so the list does not reset to
 * empty at the top of every hour.
 */
export async function getTrending(limit = 20, now = new Date()) {
  if (!env.CACHE_ENABLED) return [];

  const previous = new Date(now.getTime() - 60 * 60 * 1000);
  const redis = getRedis();

  const [current, prior] = await Promise.all([
    redis.zrevrange(hourBucket(now), 0, limit - 1, 'WITHSCORES'),
    redis.zrevrange(hourBucket(previous), 0, limit - 1, 'WITHSCORES'),
  ]);

  const totals = new Map();
  for (const list of [current, prior]) {
    for (let i = 0; i < list.length; i += 2) {
      totals.set(list[i], (totals.get(list[i]) ?? 0) + Number(list[i + 1]));
    }
  }

  return [...totals]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([slug, hits]) => ({ slug, hits }));
}
