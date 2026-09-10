import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * The seam the whole week-3 benchmark hangs on.
 *
 * Callers use this from day one, so turning the cache on later is a change to
 * this file and one env var — not a second code path, not a git branch. That
 * is what makes "no cache vs Redis" a one-variable comparison on the same
 * binary.
 *
 * Phase 6 fills in the bodies. Until then every read is a miss, which is
 * exactly the baseline the benchmark needs to measure against.
 */

export const CACHE_HIT = 'HIT';
export const CACHE_MISS = 'MISS';
export const CACHE_OFF = 'OFF';

export function isCacheEnabled() {
  return env.CACHE_ENABLED;
}

/**
 * @param {string} _key
 * @returns {Promise<{ value: unknown, status: string }>}
 */
export async function get(_key) {
  if (!env.CACHE_ENABLED) return { value: null, status: CACHE_OFF };

  // phase 6: GET, parse, report HIT
  return { value: null, status: CACHE_MISS };
}

/**
 * @param {string} _key
 * @param {unknown} _value
 * @param {number} [_ttlSeconds]
 */
export async function set(_key, _value, _ttlSeconds = env.CACHE_TTL_SECONDS) {
  if (!env.CACHE_ENABLED) return;
  // phase 6: SETEX with jittered TTL
}

/** @param {string} _key */
export async function del(_key) {
  if (!env.CACHE_ENABLED) return;
  // phase 6: DEL
}

/**
 * Every cache call must be survivable. A Redis failure logs and the caller
 * falls through to Mongo — it must never turn a working read into a 500.
 */
export async function safely(fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err: err.message }, 'cache operation failed, falling through');
    return fallback;
  }
}

export const pasteKey = (slug) => `paste:${slug}`;
