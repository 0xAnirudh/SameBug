import { z } from 'zod';

/**
 * Environment is parsed exactly once, here, and the process refuses to boot if
 * anything is missing or malformed. No other module may read `process.env` —
 * that rule is what makes a misconfiguration a startup crash with a clear
 * message instead of a `undefined is not a function` three hours into a load test.
 */

/**
 * `z.coerce.boolean()` is a trap: Boolean('false') === true, so every value in a
 * .env file would read as enabled. Parse the strings we actually expect.
 * @param {string} def
 */
const boolish = (def) =>
  z
    .union([z.boolean(), z.string()])
    .default(def)
    .transform((v) => v === true || v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL: z.string().default('7d'),

  // The entire week-3 benchmark is this one flag. Same binary, one variable.
  CACHE_ENABLED: boolish('false'),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  VIEW_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  // Its own flag, not CACHE_ENABLED: buffering views and caching reads are two
  // separate claims and each needs its own before/after.
  VIEW_BUFFER_ENABLED: boolish('true'),
  VIEW_FLUSH_BATCH: z.coerce.number().int().positive().default(500),
  // Turned off for load tests — a limiter would throttle the test itself and
  // measure the limiter instead of the system.
  RATE_LIMIT_ENABLED: boolish('true'),
  MAX_PASTE_BYTES: z.coerce.number().int().positive().default(1024 * 1024),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

/** @param {NodeJS.ProcessEnv} source */
export function parseEnv(source = process.env) {
  const result = schema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${problems}\n\nSee .env.example for the full list.`);
  }

  return Object.freeze({
    ...result.data,
    corsOrigins: result.data.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    isProd: result.data.NODE_ENV === 'production',
    isTest: result.data.NODE_ENV === 'test',
  });
}

export const env = parseEnv();
