import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { getRedis } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../lib/AppError.js';

const SCRIPT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../lua/slidingWindow.lua'),
  'utf8'
);

let registered = false;

function client() {
  const redis = getRedis();
  if (!registered) {
    // defineCommand loads the script once and calls it by SHA afterwards, so
    // the body is not resent on every request.
    redis.defineCommand('slidingWindow', { numberOfKeys: 1, lua: SCRIPT });
    registered = true;
  }
  return redis;
}

/**
 * Two algorithms, chosen per endpoint rather than one everywhere.
 *
 * 'sliding' is a log: one sorted-set member per request in the window. Precise,
 * but memory scales with traffic — fine at 10/hour on creates, wasteful at
 * 300/min on reads where it would hold 300 members per active IP.
 *
 * 'fixed' is INCR plus EXPIRE: two commands, constant memory. It allows a burst
 * across a window boundary, which for read traffic does not matter.
 */
export function rateLimit({ limit, windowMs, scope, by = ipOf, algorithm = 'fixed', failOpen = true }) {
  return async function limiter(req, res, next) {
    if (!env.RATE_LIMIT_ENABLED) return next();

    try {
      const identity = by(req);
      const key = `rl:${scope}:${identity}`;

      const [allowed, used, resetMs] =
        algorithm === 'sliding'
          ? await slidingWindow(key, limit, windowMs)
          : await fixedWindow(key, limit, windowMs);

      res.set('X-RateLimit-Limit', String(limit));
      res.set('X-RateLimit-Remaining', String(Math.max(0, limit - used)));
      res.set('X-RateLimit-Reset', String(Math.ceil(resetMs / 1000)));

      if (!allowed) {
        res.set('Retry-After', String(Math.ceil(resetMs / 1000)));
        throw AppError.tooManyRequests('You are doing that too often. Try again shortly.', {
          limit,
          retryAfterSeconds: Math.ceil(resetMs / 1000),
        });
      }

      next();
    } catch (err) {
      if (err instanceof AppError) return next(err);

      /**
       * Redis is unreachable. The posture is deliberate and per-endpoint:
       * reads fail open, because a cache outage must not take the site down.
       * Anonymous writes fail closed, because that endpoint is the actual
       * abuse target and an unguarded one is worse than a rejected one.
       */
      logger.warn({ err: err.message, scope, failOpen }, 'rate limiter unavailable');
      if (failOpen) return next();
      return next(AppError.tooManyRequests('Temporarily unavailable. Try again shortly.'));
    }
  };
}

async function slidingWindow(key, limit, windowMs) {
  const result = await client().slidingWindow(key, Date.now(), windowMs, limit, randomUUID());
  return [Number(result[0]) === 1, Number(result[1]), Number(result[2])];
}

async function fixedWindow(key, limit, windowMs) {
  const redis = getRedis();
  const bucket = `${key}:${Math.floor(Date.now() / windowMs)}`;

  const [[, used]] = await redis.multi().incr(bucket).pexpire(bucket, windowMs).exec();
  const resetMs = windowMs - (Date.now() % windowMs);

  return [Number(used) <= limit, Number(used), resetMs];
}

/** trust proxy is set, so req.ip is the client rather than the load balancer. */
function ipOf(req) {
  return req.ip ?? 'unknown';
}

/** Authenticated users get their own, more generous bucket. */
export function userOrIp(req) {
  return req.user ? `u:${req.user.id}` : `ip:${ipOf(req)}`;
}
