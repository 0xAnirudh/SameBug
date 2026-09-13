import '../helpers/env.js';
import { describe, it, expect } from 'vitest';
import { fingerprint } from '../../src/fingerprint/index.js';

/**
 * Where this design is wrong, asserted rather than hoped about.
 *
 * Both limitations below are consequences of deliberate choices, and both are
 * the honest answer to "where does it break?". If either assertion ever
 * changes, the trade-off changed with it and the README needs updating.
 */
describe('known limitations', () => {
  /**
   * LIMITATION 1 — false positives from over-normalisation.
   *
   * Two genuinely different bugs, in the same function, whose messages differ
   * only inside a quoted literal, normalise to the same string and therefore
   * collide. This is the price of stripping literals: without it every distinct
   * user id would produce its own group and grouping would do nothing at all.
   *
   * This is the expensive direction — a wrong merge hides one of the two bugs.
   */
  it('merges two different bugs when only a quoted literal differs', () => {
    const readingUserId = fingerprint(
      `TypeError: Cannot read properties of undefined (reading 'userId')
    at getUser (/srv/app/handlers/user.js:42:15)`
    );

    const readingOrderId = fingerprint(
      `TypeError: Cannot read properties of undefined (reading 'orderId')
    at getUser (/srv/app/handlers/user.js:87:11)`
    );

    expect(readingUserId.normalizedMessage).toBe(readingOrderId.normalizedMessage);
    expect(readingUserId.fingerprint).toBe(readingOrderId.fingerprint);
  });

  /**
   * LIMITATION 2 — false negatives from including the caller.
   *
   * The hash covers the top three application frames, so the same failing line
   * reached from a different caller produces a different fingerprint. Whether
   * that is correct depends on what you want: it separates "this fails during
   * checkout" from "this fails during the nightly import", at the cost of
   * splitting one root cause into two groups.
   *
   * Hashing only the top frame would trade this away for more merging.
   */
  it('splits one failing line into two groups when the caller differs', () => {
    const fromRequest = fingerprint(
      `TypeError: Cannot read properties of undefined (reading 'userId')
    at getUser (/srv/app/handlers/user.js:42:15)
    at handleRequest (/srv/app/server.js:88:5)`
    );

    const fromJob = fingerprint(
      `TypeError: Cannot read properties of undefined (reading 'userId')
    at getUser (/srv/app/handlers/user.js:42:15)
    at batchImport (/srv/app/jobs/import.js:30:4)`
    );

    expect(fromRequest.fingerprint).not.toBe(fromJob.fingerprint);
  });

  /** The design intent, stated as a test: line numbers must not matter. */
  it('is stable when an unrelated edit shifts every line in the file', () => {
    const before = fingerprint(`TypeError: x is not a function
    at render (/srv/app/view.js:12:3)`);

    const after = fingerprint(`TypeError: x is not a function
    at render (/srv/app/view.js:418:3)`);

    expect(before.fingerprint).toBe(after.fingerprint);
  });

  /** And neither must the machine it ran on. */
  it('is stable across absolute paths', () => {
    const laptop = fingerprint(`TypeError: x is not a function
    at render (/Users/ani/code/app/view.js:12:3)`);

    const server = fingerprint(`TypeError: x is not a function
    at render (/srv/prod/releases/8821/app/view.js:12:3)`);

    expect(laptop.fingerprint).toBe(server.fingerprint);
  });

  it('never throws, whatever it is handed', () => {
    const junk = ['', '   ', 'hello world', '{"json":true}', String.fromCharCode(0, 1), 'at at at'];

    for (const input of junk) {
      expect(() => fingerprint(input), JSON.stringify(input)).not.toThrow();
    }
    expect(fingerprint('hello world')).toBeNull();
  });
});
