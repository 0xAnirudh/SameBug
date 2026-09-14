import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { LANGUAGES, VISIBILITIES } from '../models/Paste.js';
import * as pastes from '../services/pasteService.js';
import { recordView } from '../services/viewCounter.js';
import { recordHit } from '../services/trending.js';
import { rateLimit, userOrIp } from '../middleware/rateLimit.js';
import { logger } from '../lib/logger.js';

/**
 * Fire and forget. A view counter must never delay, or fail, the read it is
 * counting.
 */
function countView(slug) {
  Promise.all([recordView(slug), recordHit(slug)]).catch((err) =>
    logger.warn({ err: err.message, slug }, 'view accounting failed')
  );
}

// Anonymous creation is the obvious abuse target, so it gets the precise
// algorithm and fails closed. Reads get the cheap one and fail open.
const createLimit = rateLimit({
  scope: 'create',
  by: userOrIp,
  limit: 10,
  windowMs: 60 * 60 * 1000,
  algorithm: 'sliding',
  failOpen: false,
});

const readLimit = rateLimit({
  scope: 'read',
  limit: 300,
  windowMs: 60 * 1000,
  algorithm: 'fixed',
  failOpen: true,
});

const router = Router();

const createBody = z.object({
  content: z.string().min(1, 'Paste something first'),
  title: z.string().max(120).trim().optional(),
  language: z.enum(LANGUAGES).optional(),
  visibility: z.enum(VISIBILITIES).optional(),
  expiry: z.enum(['1h', '1d', '1w', 'never']).optional(),
});

const slugParam = z.object({ slug: z.string().length(10) });

router.post('/', optionalAuth, createLimit, validate({ body: createBody }), async (req, res) => {
  const paste = await pastes.createPaste({ ...req.body, authorId: req.user?.id ?? null });
  res.status(201).json({ paste });
});

router.get('/:slug', readLimit, optionalAuth, validate({ params: slugParam }), async (req, res) => {
  const { paste, cacheStatus } = await pastes.getPasteBySlug(req.params.slug, req.user);

  // The header is how the benchmark reports a hit rate honestly.
  res.set('X-Cache', cacheStatus);
  res.json({ paste });

  countView(req.params.slug);
});

/** Plain text, for curl. Cheap to add and it demos well. */
router.get('/:slug/raw', readLimit, optionalAuth, validate({ params: slugParam }), async (req, res) => {
  const { paste, cacheStatus } = await pastes.getPasteBySlug(req.params.slug, req.user);

  res.set('X-Cache', cacheStatus);
  res.type('text/plain; charset=utf-8').send(paste.content);
});

router.delete('/:slug', requireAuth, validate({ params: slugParam }), async (req, res) => {
  await pastes.deletePaste(req.params.slug, req.user);
  res.status(204).end();
});

export default router;
