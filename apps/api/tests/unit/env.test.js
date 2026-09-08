import '../helpers/env.js';
import { describe, it, expect } from 'vitest';
import { parseEnv } from '../../src/config/env.js';

const base = {
  MONGO_URI: 'mongodb://127.0.0.1:27017/x',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('env parsing', () => {
  it('throws with a readable message when a secret is missing', () => {
    expect(() => parseEnv({ ...base, JWT_ACCESS_SECRET: undefined })).toThrow(
      /JWT_ACCESS_SECRET/
    );
  });

  it('rejects secrets that are too short to be worth having', () => {
    expect(() => parseEnv({ ...base, JWT_REFRESH_SECRET: 'short' })).toThrow(/at least 32/);
  });

  // Boolean('false') === true, which would silently enable the cache during the
  // "no cache" benchmark run and quietly invalidate the whole comparison.
  it('treats CACHE_ENABLED="false" as false', () => {
    expect(parseEnv({ ...base, CACHE_ENABLED: 'false' }).CACHE_ENABLED).toBe(false);
  });

  it('treats CACHE_ENABLED="true" and "1" as true', () => {
    expect(parseEnv({ ...base, CACHE_ENABLED: 'true' }).CACHE_ENABLED).toBe(true);
    expect(parseEnv({ ...base, CACHE_ENABLED: '1' }).CACHE_ENABLED).toBe(true);
  });

  it('defaults the cache to off', () => {
    expect(parseEnv(base).CACHE_ENABLED).toBe(false);
  });

  it('splits CORS origins into a list', () => {
    const e = parseEnv({ ...base, CORS_ORIGINS: 'http://a.com, http://b.com' });
    expect(e.corsOrigins).toEqual(['http://a.com', 'http://b.com']);
  });
});
