import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { LANGUAGES, VISIBILITIES } from '../models/Paste.js';
import * as pastes from '../services/pasteService.js';

const router = Router();

const createBody = z.object({
  content: z.string().min(1, 'Paste something first'),
  title: z.string().max(120).trim().optional(),
  language: z.enum(LANGUAGES).optional(),
  visibility: z.enum(VISIBILITIES).optional(),
  expiry: z.enum(['1h', '1d', '1w', 'never']).optional(),
});

const slugParam = z.object({ slug: z.string().length(10) });

router.post('/', optionalAuth, validate({ body: createBody }), async (req, res) => {
  const paste = await pastes.createPaste({ ...req.body, authorId: req.user?.id ?? null });
  res.status(201).json({ paste });
});

router.get('/:slug', optionalAuth, validate({ params: slugParam }), async (req, res) => {
  const { paste, cacheStatus } = await pastes.getPasteBySlug(req.params.slug, req.user);

  // The header is how the benchmark reports a hit rate honestly.
  res.set('X-Cache', cacheStatus);
  res.json({ paste });
});

/** Plain text, for curl. Cheap to add and it demos well. */
router.get('/:slug/raw', optionalAuth, validate({ params: slugParam }), async (req, res) => {
  const { paste, cacheStatus } = await pastes.getPasteBySlug(req.params.slug, req.user);

  res.set('X-Cache', cacheStatus);
  res.type('text/plain; charset=utf-8').send(paste.content);
});

router.delete('/:slug', requireAuth, validate({ params: slugParam }), async (req, res) => {
  await pastes.deletePaste(req.params.slug, req.user);
  res.status(204).end();
});

export default router;
