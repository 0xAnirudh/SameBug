import { flushViews } from '../services/viewCounter.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Drains the buffered view counters into Mongo on an interval.
 *
 * Known scaling limit, worth saying out loud: this is a singleton. Run two API
 * instances and both drain the same dirty set — SPOP means they would not
 * double-count, but they would contend, and neither would be the obvious owner.
 * Scaling horizontally means electing a leader or moving this to its own worker.
 */
export function startViewFlusher() {
  if (!env.VIEW_BUFFER_ENABLED) return () => {};

  let running = false;

  const tick = async () => {
    if (running) return; // never overlap a slow flush with the next one
    running = true;
    try {
      const { slugs, views } = await flushViews(env.VIEW_FLUSH_BATCH);
      if (slugs > 0) logger.debug({ slugs, views }, 'flushed views');
    } catch (err) {
      logger.error({ err: err.message }, 'view flush cycle failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, env.VIEW_FLUSH_INTERVAL_MS);
  timer.unref();

  logger.info({ everyMs: env.VIEW_FLUSH_INTERVAL_MS }, 'view flusher started');

  return async () => {
    clearInterval(timer);
    await tick(); // one final drain so a clean shutdown does not drop counts
  };
}
