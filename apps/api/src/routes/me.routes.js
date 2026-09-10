import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import * as pastes from '../services/pasteService.js';

const router = Router();

const listQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

router.get('/pastes', requireAuth, validate({ query: listQuery }), async (req, res) => {
  const { cursor, limit } = req.validatedQuery;
  res.json(await pastes.listPastesByAuthor(req.user.id, { cursor, limit }));
});

export default router;
