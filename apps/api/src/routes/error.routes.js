import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import * as fingerprints from '../services/fingerprintService.js';
import { isDiagnosisAvailable } from '../services/diagnoseService.js';
import { rateLimit } from '../middleware/rateLimit.js';

/**
 * Tighter than the read limits and its own bucket: every miss here costs real
 * money. Cache hits go through the same limiter, which is fine — it is
 * generous enough that reading a stored diagnosis is never the thing that
 * trips it.
 */
const diagnoseLimit = rateLimit({
  scope: 'diagnose',
  limit: 20,
  windowMs: 60 * 60 * 1000,
  algorithm: 'sliding',
  failOpen: false,
});

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

/**
 * Reads the stored diagnosis. Never spends money — a group that has not been
 * diagnosed reports that rather than generating one.
 */
router.get('/:fp/diagnosis', validate({ params: fpParam }), async (req, res) => {
  const group = await fingerprints.getFingerprint(req.params.fp);

  res.json({
    available: isDiagnosisAvailable(),
    diagnosis: group.diagnosis ?? null,
    cached: Boolean(group.diagnosis),
  });
});

/** Generates one if there is not already a current one. */
router.post('/:fp/diagnosis', diagnoseLimit, validate({ params: fpParam }), async (req, res) => {
  const result = await fingerprints.getOrCreateDiagnosis(req.params.fp, {
    force: req.query.force === 'true',
  });

  if (result.available === false) {
    return res.status(503).json({
      error: {
        code: 'DIAGNOSIS_UNAVAILABLE',
        message: 'Diagnosis is not configured on this server. Set ANTHROPIC_API_KEY to enable it.',
      },
    });
  }

  res.json(result);
});

export default router;
