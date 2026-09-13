import '../helpers/env.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { startMemoryMongo, stopMemoryMongo, clearCollections } from '../helpers/mongo.js';

const { buildApp } = await import('../../src/app.js');
const { Paste } = await import('../../src/models/Paste.js');
const { Fingerprint } = await import('../../src/models/Fingerprint.js');

/** The same bug, hit by two people on two machines after an unrelated edit. */
const TRACE_MACHINE_A = `TypeError: Cannot read properties of undefined (reading 'userId')
    at getUser (/srv/app/handlers/user.js:42:15)
    at async handleRequest (/srv/app/server.js:88:5)`;

const TRACE_MACHINE_B = `TypeError: Cannot read properties of undefined (reading 'userId')
    at getUser (/home/ani/project/handlers/user.js:58:22)
    at async handleRequest (/home/ani/project/server.js:103:9)`;

const TRACE_DIFFERENT_BUG = `TypeError: Cannot read properties of undefined (reading 'userId')
    at processPayment (/srv/app/handlers/checkout.js:12:7)`;

const PYTHON_TRACE = `Traceback (most recent call last):
  File "/srv/app/handlers/user.py", line 42, in get_user
    return cache[user_id]
KeyError: 'user_8821'`;

describe('fingerprinting through the API', () => {
  let app;
  const create = (content) => request(app).post('/api/pastes').send({ content });

  beforeAll(async () => {
    await startMemoryMongo();
    await Promise.all([Paste.syncIndexes(), Fingerprint.syncIndexes()]);
    app = buildApp();
  });
  afterAll(async () => stopMemoryMongo());
  beforeEach(async () => clearCollections());

  it('marks a parsed trace as a stacktrace and attaches the parse', async () => {
    const res = await create(TRACE_MACHINE_A);

    expect(res.status).toBe(201);
    expect(res.body.paste.kind).toBe('stacktrace');
    expect(res.body.paste.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(res.body.paste.parsed.runtime).toBe('node');
    expect(res.body.paste.parsed.errorType).toBe('TypeError');
    expect(res.body.paste.parsed.frames[0]).toMatchObject({
      function: 'getUser',
      line: 42,
      isApp: true,
    });
  });

  it('leaves ordinary code alone — no fingerprint field at all', async () => {
    const res = await create('const sum = (a, b) => a + b;');

    expect(res.body.paste.kind).toBe('code');
    // Absent, not null: the partial index keys off the field not existing.
    expect(res.body.paste.fingerprint).toBeUndefined();
  });

  // The week 2 milestone, as an assertion.
  it('groups the same bug from two machines with different paths and lines', async () => {
    const a = await create(TRACE_MACHINE_A);
    const b = await create(TRACE_MACHINE_B);

    expect(a.body.paste.fingerprint).toBe(b.body.paste.fingerprint);

    const group = await request(app).get(`/api/errors/${a.body.paste.fingerprint}`);
    expect(group.status).toBe(200);
    expect(group.body.group.count).toBe(2);
    expect(group.body.group.topFrame).toBe('user.js:getUser');
  });

  it('keeps a different bug in its own group', async () => {
    const a = await create(TRACE_MACHINE_A);
    const other = await create(TRACE_DIFFERENT_BUG);

    expect(a.body.paste.fingerprint).not.toBe(other.body.paste.fingerprint);

    const group = await request(app).get(`/api/errors/${a.body.paste.fingerprint}`);
    expect(group.body.group.count).toBe(1);
  });

  it('groups Python traces too', async () => {
    const a = await create(PYTHON_TRACE);
    const b = await create(PYTHON_TRACE.replace('line 42', 'line 190').replace('user_8821', 'user_3'));

    expect(a.body.paste.fingerprint).toBe(b.body.paste.fingerprint);
    const group = await request(app).get(`/api/errors/${a.body.paste.fingerprint}`);
    expect(group.body.group.runtime).toBe('python');
    expect(group.body.group.count).toBe(2);
  });

  it('counts occurrences atomically under concurrent writes', async () => {
    // Twelve simultaneous reports of one error. A read-modify-write would lose
    // increments here; the $inc upsert cannot.
    const results = await Promise.all(Array.from({ length: 12 }, () => create(TRACE_MACHINE_A)));
    const [fp] = [...new Set(results.map((r) => r.body.paste.fingerprint))];

    const group = await request(app).get(`/api/errors/${fp}`);
    expect(group.body.group.count).toBe(12);
  });

  it('moves lastSeenAt forward and leaves firstSeenAt alone', async () => {
    const a = await create(TRACE_MACHINE_A);
    const fp = a.body.paste.fingerprint;
    const first = (await request(app).get(`/api/errors/${fp}`)).body.group;

    await create(TRACE_MACHINE_B);
    const second = (await request(app).get(`/api/errors/${fp}`)).body.group;

    expect(second.firstSeenAt).toBe(first.firstSeenAt);
    expect(new Date(second.lastSeenAt) >= new Date(first.lastSeenAt)).toBe(true);
  });

  describe('occurrences', () => {
    it('lists every occurrence newest first, and pages', async () => {
      const first = await create(TRACE_MACHINE_A);
      const fp = first.body.paste.fingerprint;
      for (let i = 0; i < 4; i++) await create(TRACE_MACHINE_B);

      const page1 = await request(app).get(`/api/errors/${fp}/occurrences?limit=3`);
      expect(page1.status).toBe(200);
      expect(page1.body.items).toHaveLength(3);
      expect(page1.body.nextCursor).toBeTruthy();

      const page2 = await request(app).get(
        `/api/errors/${fp}/occurrences?limit=3&cursor=${encodeURIComponent(page1.body.nextCursor)}`
      );

      const slugs = [...page1.body.items, ...page2.body.items].map((p) => p.slug);
      expect(slugs).toHaveLength(5);
      expect(new Set(slugs).size).toBe(5);
    });

    it('omits content, which the list does not need', async () => {
      const a = await create(TRACE_MACHINE_A);
      const res = await request(app).get(`/api/errors/${a.body.paste.fingerprint}/occurrences`);
      expect(res.body.items[0].content).toBeUndefined();
    });
  });

  it('404s an unknown fingerprint and 400s a malformed one', async () => {
    await request(app).get(`/api/errors/${'a'.repeat(16)}`).expect(404);
    await request(app).get('/api/errors/not-a-fingerprint').expect(400);
  });

  it('never lets an unparseable paste fail the request', async () => {
    for (const junk of ['at at at', '{"a":1}', '   ', 'Traceback (most recent call last):']) {
      const res = await request(app).post('/api/pastes').send({ content: junk });
      expect(res.status).toBe(201);
      expect(res.body.paste.fingerprint).toBeUndefined();
    }
  });
});
