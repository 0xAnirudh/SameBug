import { Router } from 'express';
import { pingMongo } from '../config/mongo.js';
import { pingRedis } from '../config/redis.js';
import { getTrending } from '../services/trending.js';
import { Paste } from '../models/Paste.js';

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

/**
 * The sorted set does the ranking; Mongo is only asked to hydrate the twenty
 * slugs that came back. Computing this from Mongo alone is an aggregation with
 * a sort over a collection that only grows.
 */
router.get('/api/trending', async (_req, res) => {
  const ranked = await getTrending(20);
  if (ranked.length === 0) return res.json({ items: [] });

  const pastes = await Paste.find({ slug: { $in: ranked.map((r) => r.slug) } }).select(
    'slug title language kind createdAt'
  );

  const bySlug = new Map(pastes.map((p) => [p.slug, p]));

  res.json({
    items: ranked
      .filter((r) => bySlug.has(r.slug))
      .map((r) => ({ ...bySlug.get(r.slug).toJSON(), hits: r.hits })),
  });
});

export default router;
