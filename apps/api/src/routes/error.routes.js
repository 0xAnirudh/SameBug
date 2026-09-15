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

/**
 * "These 4 occurrences share getUser -> handleRequest; they differ in
 * deployment path, line number and the quoted value in the message."
 *
 * Separate from the group endpoint because it costs a scan of the occurrences
 * and the badge on a paste page does not need it.
 */
router.get('/:fp/variance', validate({ params: fpParam }), async (req, res) => {
  // 404 on an unknown fingerprint rather than returning an empty analysis.
  await fingerprints.getFingerprint(req.params.fp);
  res.json(await fingerprints.getVariance(req.params.fp));
});

export default router;
