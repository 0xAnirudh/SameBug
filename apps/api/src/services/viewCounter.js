import { getRedis } from '../config/redis.js';
import { Paste } from '../models/Paste.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * A Mongo write on every page view does not scale — it puts the write path on
 * the hot read path and turns a cached read into an uncached write.
 *
 * Buffered mode increments in Redis and flushes in batches. Direct mode is
 * kept so the two can be measured against each other; it is the thing being
 * improved on, not dead code.
 */

const DIRTY_SET = 'views:dirty';
const viewKey = (slug) => `views:${slug}`;

export async function recordView(slug) {
  if (!env.VIEW_BUFFER_ENABLED) {
    await Paste.updateOne({ slug }, { $inc: { views: 1 } });
    return;
  }

  /**
   * The dirty set is what makes the flush cheap. Without it the job has to
   * discover which counters moved, and the only way to do that is to walk the
   * keyspace — KEYS is O(N) over every key in the database and blocks Redis's
   * single thread while it runs. With it, the flush is proportional to what
   * actually changed.
   */
  await getRedis().multi().incr(viewKey(slug)).sadd(DIRTY_SET, slug).exec();
}

/**
 * The displayed total is the flushed value plus whatever is still pending.
 * Showing only the Mongo value makes the count visibly jump backwards right
 * after each flush, which looks broken to anyone watching.
 */
export async function pendingViews(slug) {
  if (!env.VIEW_BUFFER_ENABLED) return 0;
  const raw = await getRedis().get(viewKey(slug));
  return raw ? Number(raw) : 0;
}

/**
 * Claims a batch of dirty slugs, resets their counters atomically, and writes
 * the deltas to Mongo in one bulk operation.
 *
 * The naive version reads the counter, writes it to Mongo, then deletes the
 * key — and silently loses every view that arrived in between. GETSET makes
 * read-and-reset one operation, so increments landing during the Mongo write
 * accumulate on the freshly zeroed key and are picked up next cycle.
 *
 * @returns {Promise<{ slugs: number, views: number }>}
 */
export async function flushViews(batchSize = 500) {
  const redis = getRedis();

  const slugs = await redis.spop(DIRTY_SET, batchSize);
  if (!slugs || slugs.length === 0) return { slugs: 0, views: 0 };

  const pipeline = redis.multi();
  for (const slug of slugs) pipeline.getset(viewKey(slug), 0);
  const results = await pipeline.exec();

  const deltas = slugs.map((slug, i) => ({
    slug,
    delta: Number(results[i]?.[1] ?? 0),
  }));

  const writes = deltas
    .filter((d) => d.delta > 0)
    .map(({ slug, delta }) => ({
      updateOne: { filter: { slug }, update: { $inc: { views: delta } } },
    }));

  if (writes.length === 0) return { slugs: slugs.length, views: 0 };

  try {
    await Paste.bulkWrite(writes, { ordered: false });
  } catch (err) {
    /**
     * The one genuinely lossy window: the counters are already zeroed but the
     * durable write failed. Put the deltas back rather than throwing away view
     * counts, and re-mark the slugs dirty so the next cycle retries them.
     */
    const repair = redis.multi();
    for (const { slug, delta } of deltas) {
      if (delta > 0) repair.incrby(viewKey(slug), delta);
    }
    repair.sadd(DIRTY_SET, ...slugs);
    await repair.exec();

    logger.error({ err, slugs: slugs.length }, 'view flush failed, deltas restored');
    throw err;
  }

  return { slugs: slugs.length, views: deltas.reduce((sum, d) => sum + d.delta, 0) };
}
