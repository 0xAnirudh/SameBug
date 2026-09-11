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

  // Asserted on /api specifically: a non-API path is the SPA's to handle, and
  // whether a client build exists must not change the API's contract.
  it('shapes unknown API routes as JSON through the error handler', async () => {
    const res = await request(app).get('/api/nope');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('keeps deep unmatched API paths on the JSON contract', async () => {
    const res = await request(app).get('/api/pastes/nope/deeper/still');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});
