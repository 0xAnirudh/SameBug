import '../helpers/env.js';
import { describe, it, expect } from 'vitest';
import { fingerprint } from '../../src/fingerprint/index.js';
import { analyzeVariance } from '../../src/fingerprint/variance.js';

/** Parse a trace the way the API does, into the shape stored on a paste. */
const parse = (text) => {
  const r = fingerprint(text);
  return { message: r.message, normalizedMessage: r.normalizedMessage, frames: r.frames };
};

const NODE_A = `TypeError: Cannot read properties of undefined (reading 'userId')
    at getUser (/srv/app/handlers/user.js:42:15)
    at async handleRequest (/srv/app/server.js:88:5)`;

const NODE_B = `TypeError: Cannot read properties of undefined (reading 'userId')
    at getUser (/home/ani/project/handlers/user.js:58:22)
    at async handleRequest (/home/ani/project/server.js:103:9)`;

const NODE_C = `TypeError: Cannot read properties of undefined (reading 'orderId')
    at getUser (/var/www/billing/handlers/user.js:311:41)
    at async handleRequest (/var/www/billing/server.js:77:13)`;

describe('variance analysis', () => {
  const group = [NODE_A, NODE_B, NODE_C].map(parse);

  it('reports the frames every occurrence shares', () => {
    const { shared, occurrences } = analyzeVariance(group);

    expect(occurrences).toBe(3);
    expect(shared).toEqual([
      { file: 'user.js', function: 'getUser' },
      { file: 'server.js', function: 'handleRequest' },
    ]);
  });

  /**
   * The interesting half: recovering the literals that normalisation replaced
   * with <str>, so the page can say *which* values differed rather than just
   * that something did.
   */
  it('recovers the values a placeholder stood for', () => {
    const { varying } = analyzeVariance(group);
    const quoted = varying.find((v) => v.token === '<str>');

    expect(quoted).toBeDefined();
    expect(quoted.field).toBe('quoted value');
    expect(quoted.distinct).toBe(2);
    expect(quoted.values).toEqual(expect.arrayContaining(["'userId'", "'orderId'"]));
  });

  it('reports the deployment paths that differ, per frame', () => {
    const { varying } = analyzeVariance(group);
    const paths = varying.filter((v) => v.field === 'deployment path');

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].frame).toBe('user.js:getUser');
    expect(paths[0].distinct).toBe(3);
    expect(paths[0].values).toEqual(
      expect.arrayContaining(['/srv/app/handlers', '/home/ani/project/handlers'])
    );
  });

  it('reports the line numbers that differ, per frame', () => {
    const { varying } = analyzeVariance(group);
    const lines = varying.find((v) => v.field === 'line number');

    expect(lines.distinct).toBe(3);
    expect(lines.values).toEqual(expect.arrayContaining(['42', '58', '311']));
  });

  it('says nothing varies when the occurrences really are identical', () => {
    const result = analyzeVariance([parse(NODE_A), parse(NODE_A)]);

    expect(result.varying).toEqual([]);
    expect(result.note).toMatch(/identical/i);
  });

  it('handles a single occurrence without inventing variance', () => {
    const result = analyzeVariance([parse(NODE_A)]);
    expect(result.occurrences).toBe(1);
    expect(result.varying).toEqual([]);
  });

  it('extracts numbers as well as quoted values', () => {
    const a = parse(`Error: connect ETIMEDOUT 10.0.3.14:5432 after 30000ms
    at queryUsers (/srv/app/db/users.js:18:20)`);
    const b = parse(`Error: connect ETIMEDOUT 10.0.9.21:6543 after 45000ms
    at queryUsers (/srv/app/db/users.js:18:20)`);

    const { varying } = analyzeVariance([a, b]);

    const host = varying.find((v) => v.token === '<ip>');
    expect(host.field).toBe('host');
    expect(host.values).toEqual(expect.arrayContaining(['10.0.3.14', '10.0.9.21']));

    const numbers = varying.filter((v) => v.token === '<num>');
    expect(numbers.length).toBeGreaterThan(0);
  });

  it('works on Python traces too', () => {
    const a = parse(`Traceback (most recent call last):
  File "/srv/app/handlers/user.py", line 42, in get_user
    return cache[user_id]
KeyError: 'user_8821'`);
    const b = parse(`Traceback (most recent call last):
  File "/opt/billing/handlers/user.py", line 501, in get_user
    return cache[user_id]
KeyError: 'user_77213'`);

    const { shared, varying } = analyzeVariance([a, b]);

    expect(shared).toEqual([{ file: 'user.py', function: 'get_user' }]);
    expect(varying.find((v) => v.token === '<str>').values).toEqual(
      expect.arrayContaining(["'user_8821'", "'user_77213'"])
    );
  });

  it('degrades quietly on empty or malformed input', () => {
    expect(analyzeVariance([]).occurrences).toBe(0);
    expect(analyzeVariance(null).occurrences).toBe(0);
    expect(analyzeVariance([{ message: 'x' }]).occurrences).toBe(0);
  });
});
