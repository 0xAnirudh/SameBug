import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import * as fingerprints from '../services/fingerprintService.js';

const router = Router();

const fpParam = z.object({ fp: z.string().regex(/^[0-9a-f]{16}$/, 'Not a fingerprint') });
const pageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

router.get('/:fp', validate({ params: fpParam }), async (req, res) => {
  res.json({ group: await fingerprints.getFingerprint(req.params.fp) });
});

router.get(
  '/:fp/occurrences',
  validate({ params: fpParam, query: pageQuery }),
  async (req, res) => {
    const { cursor, limit } = req.validatedQuery;
    res.json(await fingerprints.listOccurrences(req.params.fp, { cursor, limit }));
  }
);

export default router;
