/**
 * Every test file imports this FIRST, before anything that touches config/env.js.
 * env.js parses at import time and throws on missing vars by design, so the
 * test environment has to exist before that module is ever evaluated.
 */
process.env.NODE_ENV = 'test';
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/samebug-test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/15'; // db 15: tests flush it
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-that-is-long-enough-32';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-that-is-long-enough-32';
process.env.LOG_LEVEL ??= 'silent';
// Off by default: a limiter would throttle the suite itself. The rate limit
// tests opt in explicitly, before this module is imported.
process.env.RATE_LIMIT_ENABLED ??= 'false';
process.env.VIEW_BUFFER_ENABLED ??= 'false';
