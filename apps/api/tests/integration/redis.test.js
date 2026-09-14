// Opt into the behaviour this file exists to test, before env.js is parsed.
// Written as statements + dynamic import because static imports are hoisted.
process.env.RATE_LIMIT_ENABLED = 'true';
process.env.VIEW_BUFFER_ENABLED = 'true';
process.env.CACHE_ENABLED = 'true';

await import('../helpers/env.js');

const { describe, it, expect, beforeAll, afterAll, beforeEach } = await import('vitest');
const request = (await import('supertest')).default;
const { startMemoryMongo, stopMemoryMongo, clearCollections } = await import('../helpers/mongo.js');
const { buildApp } = await import('../../src/app.js');
const { getRedis, connectRedis, disconnectRedis } = await import('../../src/config/redis.js');
const { Paste } = await import('../../src/models/Paste.js');
const { flushViews, pendingViews } = await import('../../src/services/viewCounter.js');
const { getTrending } = await import('../../src/services/trending.js');

describe('redis-backed behaviour', () => {
  let app;
  let redis;

  beforeAll(async () => {
    await startMemoryMongo();
    await Paste.syncIndexes();

    // buildApp() does not connect Redis — index.js does. The client is created
    // with lazyConnect and enableOfflineQueue:false, so commands before an
    // explicit connect throw rather than queue. Mirror the real bootstrap.
    await connectRedis();
    redis = getRedis();

    app = buildApp();
  });

  afterAll(async () => {
    await redis.flushdb();
    await disconnectRedis();
    await stopMemoryMongo();
  });

  beforeEach(async () => {
    await clearCollections();
    await redis.flushdb();
  });

  const create = (content = 'hello') => request(app).post('/api/pastes').send({ content });

  describe('cache', () => {
    it('misses once, then hits', async () => {
      const { body } = await create();
      const slug = body.paste.slug;

      const first = await request(app).get(`/api/pastes/${slug}`);
      const second = await request(app).get(`/api/pastes/${slug}`);

      expect(first.headers['x-cache']).toBe('MISS');
      expect(second.headers['x-cache']).toBe('HIT');
      expect(second.body.paste.content).toBe('hello');
    });

    it('drops the key on delete, so a deleted paste cannot be served from cache', async () => {
      const reg = await request(app)
        .post('/api/auth/register')
        .send({ email: 'cache@example.com', password: 'cache-test-password' });
      const token = reg.body.accessToken;

      const { body } = await request(app)
        .post('/api/pastes')
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'temporary' });
      const slug = body.paste.slug;

      await request(app).get(`/api/pastes/${slug}`).expect(200);
      expect(await redis.exists(`paste:${slug}`)).toBe(1);

      await request(app)
        .delete(`/api/pastes/${slug}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect(await redis.exists(`paste:${slug}`)).toBe(0);
      await request(app).get(`/api/pastes/${slug}`).expect(404);
    });

    // Without this, anyone walking the slug space sends every miss to Mongo.
    it('remembers a 404 so slug scanning cannot hammer mongo', async () => {
      await request(app).get('/api/pastes/zzzzzzzzzz').expect(404);
      expect(await redis.exists('paste:zzzzzzzzzz')).toBe(1);
      await request(app).get('/api/pastes/zzzzzzzzzz').expect(404);
    });
  });

  describe('view counter', () => {
    it('buffers in redis instead of writing to mongo on every read', async () => {
      const { body } = await create();
      const slug = body.paste.slug;

      for (let i = 0; i < 5; i++) await request(app).get(`/api/pastes/${slug}`);
      await new Promise((r) => setTimeout(r, 120)); // the count is fire-and-forget

      expect(await pendingViews(slug)).toBe(5);
      // Nothing has reached the durable store yet — that is the entire point.
      expect((await Paste.findOne({ slug })).views).toBe(0);
    });

    it('flushes deltas to mongo and resets the counter', async () => {
      const { body } = await create();
      const slug = body.paste.slug;

      for (let i = 0; i < 3; i++) await request(app).get(`/api/pastes/${slug}`);
      await new Promise((r) => setTimeout(r, 120));

      const result = await flushViews();
      expect(result.views).toBe(3);

      expect((await Paste.findOne({ slug })).views).toBe(3);
      expect(await pendingViews(slug)).toBe(0);
    });

    // GETSET makes read-and-reset one operation, so nothing lands in the gap.
    it('does not lose views that arrive during a flush', async () => {
      const { body } = await create();
      const slug = body.paste.slug;

      for (let i = 0; i < 4; i++) await request(app).get(`/api/pastes/${slug}`);
      await new Promise((r) => setTimeout(r, 120));

      const [flushed] = await Promise.all([
        flushViews(),
        request(app).get(`/api/pastes/${slug}`),
      ]);
      await new Promise((r) => setTimeout(r, 120));

      await flushViews();
      const total = (await Paste.findOne({ slug })).views + (await pendingViews(slug));

      expect(flushed.views).toBeGreaterThanOrEqual(4);
      expect(total).toBe(5);
    });

    it('uses a dirty set so the flush never has to walk the keyspace', async () => {
      const { body } = await create();
      await request(app).get(`/api/pastes/${body.paste.slug}`);
      await new Promise((r) => setTimeout(r, 120));

      expect(await redis.smembers('views:dirty')).toContain(body.paste.slug);
    });
  });

  describe('trending', () => {
    it('ranks by hits in the current hour bucket', async () => {
      const hot = (await create('hot paste')).body.paste.slug;
      const cold = (await create('cold paste')).body.paste.slug;

      for (let i = 0; i < 5; i++) await request(app).get(`/api/pastes/${hot}`);
      await request(app).get(`/api/pastes/${cold}`);
      await new Promise((r) => setTimeout(r, 150));

      const ranked = await getTrending(10);
      expect(ranked[0].slug).toBe(hot);
      expect(ranked[0].hits).toBe(5);

      const res = await request(app).get('/api/trending');
      expect(res.status).toBe(200);
      expect(res.body.items[0].slug).toBe(hot);
    });
  });

  describe('rate limiting', () => {
    it('allows up to the limit then returns 429 with a Retry-After', async () => {
      const statuses = [];
      for (let i = 0; i < 12; i++) {
        const res = await create(`paste ${i}`);
        statuses.push(res.status);
      }

      const allowed = statuses.filter((s) => s === 201).length;
      const blocked = statuses.filter((s) => s === 429).length;

      expect(allowed).toBe(10); // 10 anonymous creates per hour
      expect(blocked).toBe(2);

      const last = await create('one more');
      expect(last.status).toBe(429);
      expect(last.headers['retry-after']).toBeTruthy();
      expect(last.body.error.code).toBe('RATE_LIMITED');
    });

    it('reports the budget on every response, not only on rejection', async () => {
      const res = await create('first');
      expect(res.headers['x-ratelimit-limit']).toBe('10');
      expect(res.headers['x-ratelimit-remaining']).toBe('9');
    });

    it('gives reads a far larger budget than writes', async () => {
      const { body } = await create();
      const res = await request(app).get(`/api/pastes/${body.paste.slug}`);
      expect(res.headers['x-ratelimit-limit']).toBe('300');
    });
  });
});
