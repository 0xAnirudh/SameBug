import '../helpers/env.js';
import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';

describe('model registration', () => {
  /**
   * Regression: mongoose.model() throws OverwriteModelError on a second
   * registration of the same name. The mongoose singleton outlives a module
   * registry reset, so a test runner reusing a worker process re-evaluates the
   * model file against an already-populated registry. This surfaced as an
   * intermittent suite failure that depended on which worker picked up a file.
   */
  it('reuses an already-compiled model rather than re-registering it', async () => {
    const { User } = await import('../../src/models/User.js');

    expect(mongoose.models.User).toBe(User);

    // The guard expression itself, re-evaluated. Must not throw.
    expect(() => mongoose.models.User ?? mongoose.model('User', new mongoose.Schema({}))).not.toThrow();

    // And the unguarded form is genuinely unsafe — this is what we avoid.
    expect(() => mongoose.model('User', new mongoose.Schema({}))).toThrow(/Cannot overwrite/);
  });
});
