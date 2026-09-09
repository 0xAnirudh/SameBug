import '../helpers/env.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { startMemoryMongo, stopMemoryMongo, clearCollections } from '../helpers/mongo.js';

const { buildApp } = await import('../../src/app.js');
const { User } = await import('../../src/models/User.js');

const CREDS = { email: 'ani@example.com', password: 'correct-horse-battery' };

/** Pulls the refresh cookie out of a response so we can replay it. */
function refreshCookie(res) {
  const raw = res.headers['set-cookie']?.find((c) => c.startsWith('sb_refresh='));
  return raw?.split(';')[0];
}

describe('auth', () => {
  let app;

  beforeAll(async () => {
    await startMemoryMongo();
    await User.syncIndexes(); // autoIndex is off, so the unique index is explicit
    app = buildApp();
  });
  afterAll(async () => stopMemoryMongo());
  beforeEach(async () => clearCollections());

  describe('register', () => {
    it('creates a user and returns a session', async () => {
      const res = await request(app).post('/api/auth/register').send(CREDS);

      expect(res.status).toBe(201);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.user.email).toBe(CREDS.email);
      expect(refreshCookie(res)).toBeTruthy();
    });

    it('never returns the password hash', async () => {
      const res = await request(app).post('/api/auth/register').send(CREDS);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      expect(res.body.user.passwordHash).toBeUndefined();
    });

    it('keeps the refresh token httpOnly and off the general path', async () => {
      const res = await request(app).post('/api/auth/register').send(CREDS);
      const raw = res.headers['set-cookie'].find((c) => c.startsWith('sb_refresh='));

      expect(raw).toContain('HttpOnly');
      expect(raw).toContain('Path=/api/auth');
      expect(raw).toContain('SameSite=Lax');
    });

    it('rejects a duplicate email with 409', async () => {
      await request(app).post('/api/auth/register').send(CREDS);
      const res = await request(app).post('/api/auth/register').send(CREDS);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_TAKEN');
    });

    it('rejects a short password before hashing it', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ ...CREDS, password: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send(CREDS);
    });

    it('returns a session for correct credentials', async () => {
      const res = await request(app).post('/api/auth/login').send(CREDS);
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTruthy();
    });

    // The same message for both, so response bodies cannot be used to
    // enumerate which emails are registered.
    it('gives the same error for a wrong password and an unknown email', async () => {
      const wrongPass = await request(app)
        .post('/api/auth/login')
        .send({ ...CREDS, password: 'wrong-but-long-enough' });
      const noUser = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong-but-long-enough' });

      expect(wrongPass.status).toBe(401);
      expect(noUser.status).toBe(401);
      expect(wrongPass.body.error.message).toBe(noUser.body.error.message);
      expect(wrongPass.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('access tokens', () => {
    it('lets a valid token read /me', async () => {
      const { body } = await request(app).post('/api/auth/register').send(CREDS);
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(CREDS.email);
    });

    it('rejects a missing token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('rejects a tampered signature', async () => {
      const { body } = await request(app).post('/api/auth/register').send(CREDS);
      const forged = body.accessToken.slice(0, -4) + 'aaaa';

      const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('reports an expired token distinctly, so the client knows to refresh', async () => {
      const user = await User.findOne({ email: CREDS.email }).lean();
      const expired = jwt.sign({ sub: String(user?._id) }, process.env.JWT_ACCESS_SECRET, {
        expiresIn: '-1s',
      });

      const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    });
  });

  describe('refresh', () => {
    it('rotates: a refresh returns a new cookie', async () => {
      const reg = await request(app).post('/api/auth/register').send(CREDS);
      const first = refreshCookie(reg);

      const res = await request(app).post('/api/auth/refresh').set('Cookie', first);

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeTruthy();
      expect(refreshCookie(res)).toBeTruthy();
    });

    it('refuses a request with no cookie', async () => {
      const res = await request(app).post('/api/auth/refresh');
      expect(res.status).toBe(401);
    });

    // The whole reason tokenVersion exists.
    it('invalidates every outstanding token after logout-everywhere', async () => {
      const reg = await request(app).post('/api/auth/register').send(CREDS);
      const cookie = refreshCookie(reg);

      await request(app).post('/api/auth/logout?all=true').set('Cookie', cookie).expect(204);

      const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toMatch(/signed out/i);
    });

    it('leaves other sessions alone on a plain logout', async () => {
      const reg = await request(app).post('/api/auth/register').send(CREDS);
      const cookie = refreshCookie(reg);

      await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(204);

      // Plain logout only clears the browser's cookie; the token itself stays
      // valid until it expires. Stating that limitation is the point of the test.
      const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
      expect(res.status).toBe(200);
    });
  });
});
