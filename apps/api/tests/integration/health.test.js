import '../helpers/env.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { startMemoryMongo, stopMemoryMongo } from '../helpers/mongo.js';

const { buildApp } = await import('../../src/app.js');

describe('GET /health', () => {
  let app;

  beforeAll(async () => {
    await startMemoryMongo();
    app = buildApp();
  });

  afterAll(async () => {
    await stopMemoryMongo();
  });

  it('reports ok-or-degraded with Mongo up', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.checks.mongo).toBe(true);
    // Redis is intentionally optional — no local Redis must not fail the check.
    expect(['ok', 'degraded']).toContain(res.body.status);
  });

  it('echoes a request id on every response', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('shapes unknown routes through the error handler', async () => {
    const res = await request(app).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBeTruthy();
  });
});
