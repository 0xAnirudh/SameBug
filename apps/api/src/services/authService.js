import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { AppError } from '../lib/AppError.js';
import { env } from '../config/env.js';

/**
 * Cost 12 is roughly 250ms of deliberate CPU. bcrypt's async API runs on
 * libuv's threadpool (4 threads by default), so simultaneous logins queue —
 * a burst will visibly stall unrelated requests. That is a measured, accepted
 * cost, not an oversight.
 */
const BCRYPT_COST = 12;

/**
 * A hash to compare against when the email doesn't exist, so a missing user and
 * a wrong password take about the same time. Without this, response timing
 * tells an attacker which emails are registered.
 */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

export async function register(email, password) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  try {
    return await User.create({ email, passwordHash });
  } catch (err) {
    if (err.code === 11000) {
      throw new AppError(409, 'EMAIL_TAKEN', 'That email is already registered');
    }
    throw err;
  }
}

export async function login(email, password) {
  const user = await User.findOne({ email: email.toLowerCase().trim() });

  // Always run a comparison, even with no user, to keep the timing flat.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  // One message for both failure modes — never reveal which half was wrong.
  if (!user || !ok) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }

  return user;
}

export function signAccessToken(user) {
  return jwt.sign({ sub: user.id }, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TTL });
}

export function signRefreshToken(user) {
  return jwt.sign({ sub: user.id, ver: user.tokenVersion }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.REFRESH_TTL,
  });
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET);
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    throw new AppError(
      401,
      expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      expired ? 'Your session expired' : 'That token is not valid'
    );
  }
}

/**
 * Verifies a refresh token and returns its user. Rotation is the caller's job:
 * every successful refresh must mint a new pair.
 */
export async function consumeRefreshToken(token) {
  if (!token) throw AppError.unauthorized('No refresh token');

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_REFRESH_SECRET);
  } catch {
    throw AppError.unauthorized('That session is no longer valid');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw AppError.unauthorized('That session is no longer valid');

  // The revocation check. A logout-everywhere bumped the version past this token.
  if (user.tokenVersion !== payload.ver) {
    throw AppError.unauthorized('That session was signed out');
  }

  return user;
}

/** Invalidates every refresh token this user holds, everywhere. */
export async function revokeAllSessions(userId) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
}

export const REFRESH_COOKIE = 'sb_refresh';

/**
 * Scoped to /api/auth rather than /api/auth/refresh so that logout can read it
 * too — a cookie is only sent to paths at or below its own.
 */
export const refreshCookieOptions = {
  httpOnly: true,
  secure: env.isProd,
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};
