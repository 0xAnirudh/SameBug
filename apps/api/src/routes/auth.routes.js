import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import * as auth from '../services/authService.js';

const router = Router();

const credentials = z.object({
  email: z.string().email('Enter a valid email address').max(254),
  password: z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(200, 'That password is too long to hash'),
});

/** Mints a fresh pair and puts the refresh half in an httpOnly cookie. */
function issueSession(res, user) {
  res.cookie(auth.REFRESH_COOKIE, auth.signRefreshToken(user), auth.refreshCookieOptions);
  return { accessToken: auth.signAccessToken(user), user };
}

router.post('/register', validate({ body: credentials }), async (req, res) => {
  const user = await auth.register(req.body.email, req.body.password);
  res.status(201).json(issueSession(res, user));
});

router.post('/login', validate({ body: credentials }), async (req, res) => {
  const user = await auth.login(req.body.email, req.body.password);
  res.json(issueSession(res, user));
});

/**
 * Rotation: every successful refresh mints a new pair, so a stolen refresh
 * token has a bounded useful life.
 */
router.post('/refresh', async (req, res) => {
  const user = await auth.consumeRefreshToken(req.cookies?.[auth.REFRESH_COOKIE]);
  res.json(issueSession(res, user));
});

router.post('/logout', async (req, res) => {
  // ?all=true bumps tokenVersion, which kills every session on every device.
  if (req.query.all === 'true') {
    const user = await auth
      .consumeRefreshToken(req.cookies?.[auth.REFRESH_COOKIE])
      .catch(() => null);
    if (user) await auth.revokeAllSessions(user.id);
  }

  res.clearCookie(auth.REFRESH_COOKIE, { ...auth.refreshCookieOptions, maxAge: undefined });
  res.status(204).end();
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
