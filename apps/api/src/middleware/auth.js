import { verifyAccessToken } from '../services/authService.js';
import { User } from '../models/User.js';
import { AppError } from '../lib/AppError.js';

function bearer(req) {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/** Rejects the request unless a valid access token is present. */
export async function requireAuth(req, _res, next) {
  try {
    const token = bearer(req);
    if (!token) throw AppError.unauthorized();

    const { sub } = verifyAccessToken(token);
    const user = await User.findById(sub);
    if (!user) throw AppError.unauthorized();

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Attaches req.user when a valid token is present and does nothing otherwise.
 * Most paste routes want this — anonymous use is the primary path, and an
 * expired token should not turn a public read into a 401.
 */
export async function optionalAuth(req, _res, next) {
  const token = bearer(req);
  if (!token) return next();

  try {
    const { sub } = verifyAccessToken(token);
    req.user = (await User.findById(sub)) ?? undefined;
  } catch {
    // Deliberately swallowed.
  }
  next();
}
