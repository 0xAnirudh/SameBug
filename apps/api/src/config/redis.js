import Redis from 'ioredis';
import { env } from './env.js';
import { logger } from '../lib/logger.js';

/** @type {Redis | null} */
let client = null;

/**
 * Redis is a cache, never the source of truth. The app must boot, serve and
 * pass health checks with Redis unreachable — every caller degrades to Mongo.
 */
export function getRedis() {
  if (client) return client;

  client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false, // fail fast instead of piling up commands
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });

  client.on('error', (err) => logger.warn({ err: err.message }, 'redis error'));
  client.on('ready', () => logger.info('redis ready'));

  return client;
}

export async function connectRedis() {
  const redis = getRedis();
  try {
    await redis.connect();
  } catch (err) {
    // Deliberately not fatal.
    logger.warn({ err: err.message }, 'redis unavailable at boot — running without cache');
  }
  return redis;
}

export async function disconnectRedis() {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
  client = null;
}

/** @returns {Promise<boolean>} */
export async function pingRedis() {
  try {
    if (!client || client.status !== 'ready') return false;
    return (await client.ping()) === 'PONG';
  } catch {
    return false;
  }
}
