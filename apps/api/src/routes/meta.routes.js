import { Router } from 'express';
import { pingMongo } from '../config/mongo.js';
import { pingRedis } from '../config/redis.js';

const router = Router();

/**
 * Health is honest about the difference between the two stores:
 * Mongo down  -> 503, the service cannot do its job.
 * Redis down  -> 200 "degraded", reads fall through to Mongo and still work.
 */
router.get('/health', async (_req, res) => {
  const [mongo, redis] = await Promise.all([pingMongo(), pingRedis()]);

  const status = !mongo ? 'down' : redis ? 'ok' : 'degraded';
  res.status(mongo ? 200 : 503).json({
    status,
    uptime: Math.round(process.uptime()),
    checks: { mongo, redis },
  });
});

export default router;
