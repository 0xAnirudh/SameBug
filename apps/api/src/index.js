import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { connectMongo, disconnectMongo } from './config/mongo.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { startViewFlusher } from './jobs/flushViews.js';

async function main() {
  // Mongo is required to serve. Redis is not — connectRedis resolves either way.
  await connectMongo();
  await connectRedis();

  const stopFlusher = startViewFlusher();

  const app = buildApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV, cache: env.CACHE_ENABLED }, 'samebug api up');
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    // Stop accepting connections, let in-flight requests finish, then close
    // the stores. Closing them first would fail those requests for no reason.
    server.close(async () => {
      await Promise.allSettled([stopFlusher()]);
      await Promise.allSettled([disconnectMongo(), disconnectRedis()]);
      logger.info('shutdown complete');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('forced exit after 10s grace period');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
