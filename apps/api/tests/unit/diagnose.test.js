import '../helpers/env.js';
import { describe, it, expect } from 'vitest';
import { buildPrompt, isDiagnosisAvailable } from '../../src/services/diagnoseService.js';
import { fingerprint } from '../../src/fingerprint/index.js';
import { analyzeVariance } from '../../src/fingerprint/variance.js';

const TRACE_A = `TypeError: Cannot read properties of undefined (reading 'userId')
    at getUser (/srv/app/handlers/user.js:42:15)
    at async handleRequest (/srv/app/server.js:88:5)`;

const TRACE_B = `TypeError: Cannot read properties of undefined (reading 'userId')
    at getUser (/home/anirudh/secret-project/handlers/user.js:58:22)
    at async handleRequest (/home/anirudh/secret-project/server.js:103:9)`;

function groupFrom(traces) {
  const parsed = traces.map((t) => fingerprint(t));
  const first = parsed[0];

  return {
    group: {
      _id: first.fingerprint,
      runtime: first.runtime,
      errorType: first.errorType,
      normalizedMessage: first.normalizedMessage,
      topFrame: first.topFrame,
      allFramesAreVendor: first.allFramesAreVendor,
      count: parsed.length,
    },
    variance: analyzeVariance(
      parsed.map((p) => ({
        message: p.message,
        normalizedMessage: p.normalizedMessage,
        frames: p.frames,
      }))
    ),
  };
}

describe('diagnosis', () => {
  it('is unavailable without a configured key, rather than erroring', () => {
    expect(isDiagnosisAvailable()).toBe(false);
  });

  /**
   * THE test for this feature. buildPrompt is the privacy boundary: whatever it
   * does not assemble never leaves the server. The fingerprinting pipeline has
   * already stripped literals, so the prompt is anonymous as a consequence of
   * the grouping design rather than as a separate scrubbing step.
   */
  describe('what actually gets sent', () => {
    const { group, variance } = groupFrom([TRACE_A, TRACE_B]);
    const prompt = buildPrompt(group, variance);

    it('never includes an absolute path', () => {
      expect(prompt).not.toContain('/srv/app');
      expect(prompt).not.toContain('/home/anirudh');
      expect(prompt).not.toContain('secret-project');
      expect(prompt).not.toMatch(/\/[a-z]+\/[a-z]+\//i);
    });

    it('never includes the literal from the message', () => {
      expect(prompt).not.toContain('userId');
      expect(prompt).toContain('<str>');
    });

    it('never includes raw paste content or line numbers', () => {
      expect(prompt).not.toContain('at getUser (');
      expect(prompt).not.toContain(':42:15');
    });

    it('does include what is needed to reason about the bug', () => {
      expect(prompt).toContain('TypeError');
      expect(prompt).toContain('node');
      expect(prompt).toContain('getUser');
      expect(prompt).toContain('user.js');
      expect(prompt).toContain('Seen 2 times');
    });

    it('reduces frames to basename and function, nothing more', () => {
      expect(prompt).toMatch(/getUser \(user\.js\)/);
      expect(prompt).toMatch(/handleRequest \(server\.js\)/);
    });

    it('tells the model which fields varied, without the values', () => {
      expect(prompt).toMatch(/deployment path.*distinct values/);
    });
  });

  it('flags a trace with no application frames, so the model does not over-claim', () => {
    const { group, variance } = groupFrom([
      `TypeError: Cannot read properties of null (reading 'pipe')
    at Readable.pipe (node:internal/streams/readable:1000:10)
    at SendStream.pipe (/srv/app/node_modules/send/index.js:597:23)`,
    ]);

    const prompt = buildPrompt(group, variance);
    expect(prompt).toMatch(/entirely inside library code|every frame is library code/i);
  });

  it('builds a usable prompt from a single occurrence', () => {
    const { group, variance } = groupFrom([TRACE_A]);
    const prompt = buildPrompt(group, variance);

    expect(prompt).toContain('Seen 1 time');
    expect(prompt).not.toContain('Seen 1 times');
  });
});
