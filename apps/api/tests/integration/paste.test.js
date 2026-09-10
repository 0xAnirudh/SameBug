import '../helpers/env.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startMemoryMongo, stopMemoryMongo, clearCollections } from '../helpers/mongo.js';

const { buildApp } = await import('../../src/app.js');
const { Paste } = await import('../../src/models/Paste.js');
const { User } = await import('../../src/models/User.js');

describe('pastes', () => {
  let app;

  /** Registers a user and returns its bearer token. */
  async function signUp(email) {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'correct-horse-battery' });
    return res.body.accessToken;
  }

  const create = (body, token) => {
    const req = request(app).post('/api/pastes').send(body);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  beforeAll(async () => {
    await startMemoryMongo();
    await Promise.all([User.syncIndexes(), Paste.syncIndexes()]);
    app = buildApp();
  });
  afterAll(async () => stopMemoryMongo());
  beforeEach(async () => clearCollections());

  describe('create', () => {
    it('accepts an anonymous paste and returns a 10-char slug', async () => {
      const res = await create({ content: 'hello world' });

      expect(res.status).toBe(201);
      expect(res.body.paste.slug).toHaveLength(10);
      expect(res.body.paste.authorId).toBeNull();
    });

    it('attaches the author when a token is present', async () => {
      const token = await signUp('owner@example.com');
      const res = await create({ content: 'const x = 1;' }, token);

      expect(res.status).toBe(201);
      expect(res.body.paste.authorId).toBeTruthy();
    });

    it('rejects an empty paste', async () => {
      const res = await create({ content: '' });
      expect(res.status).toBe(400);
    });

    // The cap is bytes on the wire, not string length.
    it('rejects a paste over the byte cap with 413', async () => {
      const res = await create({ content: 'x'.repeat(1024 * 1024 + 10) });

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('detects language when the client does not say', async () => {
      const js = await create({ content: 'const foo = () => require("bar");' });
      const py = await create({ content: 'class A:\n    def __init__(self):\n        pass' });
      const json = await create({ content: '{"a": 1, "b": [2, 3]}' });

      expect(js.body.paste.language).toBe('javascript');
      expect(py.body.paste.language).toBe('python');
      expect(json.body.paste.language).toBe('json');
    });

    it('lets the client override detection', async () => {
      const res = await create({ content: 'const x = 1', language: 'plaintext' });
      expect(res.body.paste.language).toBe('plaintext');
    });

    it('sets expiresAt from a preset, and null for never', async () => {
      const hour = await create({ content: 'a', expiry: '1h' });
      const never = await create({ content: 'b', expiry: 'never' });

      const delta = new Date(hour.body.paste.expiresAt) - Date.now();
      expect(delta).toBeGreaterThan(59 * 60 * 1000);
      expect(delta).toBeLessThanOrEqual(60 * 60 * 1000);
      expect(never.body.paste.expiresAt).toBeNull();
    });
  });

  describe('read', () => {
    it('returns a paste by slug and reports cache status', async () => {
      const { body } = await create({ content: 'readable' });
      const res = await request(app).get(`/api/pastes/${body.paste.slug}`);

      expect(res.status).toBe(200);
      expect(res.body.paste.content).toBe('readable');
      // Cache is off in phase 3; the header still has to be honest about it.
      expect(res.headers['x-cache']).toBe('OFF');
    });

    it('serves raw as text/plain for curl', async () => {
      const { body } = await create({ content: 'line one\nline two' });
      const res = await request(app).get(`/api/pastes/${body.paste.slug}/raw`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toBe('line one\nline two');
    });

    it('404s an unknown slug', async () => {
      const res = await request(app).get('/api/pastes/aaaaaaaaaa');
      expect(res.status).toBe(404);
    });

    it('400s a slug that is the wrong shape', async () => {
      const res = await request(app).get('/api/pastes/short');
      expect(res.status).toBe(400);
    });

    it('lets anyone read an unlisted paste — the slug is the secret', async () => {
      const { body } = await create({ content: 'unlisted', visibility: 'unlisted' });
      const res = await request(app).get(`/api/pastes/${body.paste.slug}`);
      expect(res.status).toBe(200);
    });

    describe('private', () => {
      it('404s rather than 403s for a stranger, so the slug is not confirmed', async () => {
        const token = await signUp('owner@example.com');
        const { body } = await create({ content: 'secret', visibility: 'private' }, token);

        const res = await request(app).get(`/api/pastes/${body.paste.slug}`);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      });

      it('lets the owner read it', async () => {
        const token = await signUp('owner@example.com');
        const { body } = await create({ content: 'secret', visibility: 'private' }, token);

        const res = await request(app)
          .get(`/api/pastes/${body.paste.slug}`)
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.paste.content).toBe('secret');
      });
    });
  });

  describe('delete', () => {
    it('lets the owner delete', async () => {
      const token = await signUp('owner@example.com');
      const { body } = await create({ content: 'mine' }, token);

      await request(app)
        .delete(`/api/pastes/${body.paste.slug}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      await request(app).get(`/api/pastes/${body.paste.slug}`).expect(404);
    });

    it('refuses a different user', async () => {
      const owner = await signUp('owner@example.com');
      const other = await signUp('other@example.com');
      const { body } = await create({ content: 'mine' }, owner);

      const res = await request(app)
        .delete(`/api/pastes/${body.paste.slug}`)
        .set('Authorization', `Bearer ${other}`);

      expect(res.status).toBe(403);
    });

    // Anonymous pastes have no owner, so there is nobody who can delete them.
    it('refuses an anonymous paste, which has no owner at all', async () => {
      const token = await signUp('someone@example.com');
      const { body } = await create({ content: 'nobody owns this' });

      const res = await request(app)
        .delete(`/api/pastes/${body.paste.slug}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/expire/i);
    });

    it('requires a token at all', async () => {
      const { body } = await create({ content: 'x' });
      await request(app).delete(`/api/pastes/${body.paste.slug}`).expect(401);
    });
  });

  describe('my pastes', () => {
    it('lists newest first and pages with a cursor, never repeating or skipping', async () => {
      const token = await signUp('owner@example.com');
      for (let i = 0; i < 7; i++) await create({ content: `paste ${i}` }, token);

      const first = await request(app)
        .get('/api/me/pastes?limit=3')
        .set('Authorization', `Bearer ${token}`);

      expect(first.status).toBe(200);
      expect(first.body.items).toHaveLength(3);
      expect(first.body.nextCursor).toBeTruthy();

      const second = await request(app)
        .get(`/api/me/pastes?limit=3&cursor=${encodeURIComponent(first.body.nextCursor)}`)
        .set('Authorization', `Bearer ${token}`);

      const third = await request(app)
        .get(`/api/me/pastes?limit=3&cursor=${encodeURIComponent(second.body.nextCursor)}`)
        .set('Authorization', `Bearer ${token}`);

      const seen = [...first.body.items, ...second.body.items, ...third.body.items].map(
        (p) => p.slug
      );

      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7); // no repeats
      expect(third.body.nextCursor).toBeNull(); // and the end is signalled
    });

    it('omits content from the list, which is the expensive field', async () => {
      const token = await signUp('owner@example.com');
      await create({ content: 'a very long body' }, token);

      const res = await request(app).get('/api/me/pastes').set('Authorization', `Bearer ${token}`);
      expect(res.body.items[0].content).toBeUndefined();
    });

    it('never shows another user their pastes', async () => {
      const owner = await signUp('owner@example.com');
      const other = await signUp('other@example.com');
      await create({ content: 'owned' }, owner);

      const res = await request(app).get('/api/me/pastes').set('Authorization', `Bearer ${other}`);
      expect(res.body.items).toHaveLength(0);
    });

    it('rejects a malformed cursor instead of returning nonsense', async () => {
      const token = await signUp('owner@example.com');
      const res = await request(app)
        .get('/api/me/pastes?cursor=not-a-real-cursor')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });
});
