import '../helpers/env.js';
import { describe, it, expect } from 'vitest';
import { normalizeMessage, applyRule, RULES } from '../../src/fingerprint/normalize.js';

describe('normalization rules', () => {
  it('has every rule individually testable', () => {
    expect(RULES.map((r) => r.name)).toEqual([
      'timestamp',
      'uuid',
      'objectid',
      'address',
      'url',
      'ip',
      'email',
      'path',
      'quoted',
      'hash',
      'number',
    ]);
  });

  const cases = [
    ['timestamp', 'failed at 2026-09-08T11:15:00.123Z now', 'failed at <ts> now'],
    ['uuid', 'user 3f2504e0-4f89-11d3-9a0c-0305e82c3301 missing', 'user <uuid> missing'],
    ['objectid', 'doc 6aa909102ee4e31798ff1892 gone', 'doc <oid> gone'],
    ['address', 'segfault at 0x7fff5fbff8c0', 'segfault at <addr>'],
    ['url', 'GET https://api.example.com/v1/users?id=4 failed', 'GET <url> failed'],
    ['ip', 'connect to 10.0.3.14 refused', 'connect to <ip> refused'],
    ['email', 'no account for ani@example.co.uk', 'no account for <email>'],
    ['path', 'cannot open /srv/app/config/load.js', 'cannot open <path>'],
    ['quoted', "reading 'userId' of undefined", 'reading <str> of undefined'],
    ['hash', 'token deadbeefdeadbeefdead1234 rejected', 'token <hash> rejected'],
    ['number', 'index 42 out of range', 'index <num> out of range'],
  ];

  for (const [rule, input, expected] of cases) {
    it(`${rule}: ${input}`, () => {
      expect(applyRule(rule, input)).toBe(expected);
    });
  }

  describe('rule order', () => {
    // If the bare-number rule ran first it would shred these before anything
    // could recognise them. Order is the whole design of this module.
    it('keeps a UUID whole instead of digesting its digits', () => {
      expect(normalizeMessage('id 3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe('id <uuid>');
    });

    it('keeps a timestamp whole', () => {
      expect(normalizeMessage('at 2026-09-08T11:15:00Z')).toBe('at <ts>');
    });

    it('treats a URL as a URL, not as a path with slashes', () => {
      expect(normalizeMessage('fetch https://a.io/b/c failed')).toBe('fetch <url> failed');
    });
  });

  it('collapses whitespace and lowercases, so formatting cannot split a group', () => {
    expect(normalizeMessage('  Cannot   READ\n  property  ')).toBe('cannot read property');
  });

  it('handles an empty message', () => {
    expect(normalizeMessage('')).toBe('');
    expect(normalizeMessage(undefined)).toBe('');
  });

  it('normalises two occurrences of one bug to the same string', () => {
    const a = normalizeMessage("Cannot read property 'userId' of undefined at index 42");
    const b = normalizeMessage("Cannot read property 'orgId' of undefined at index 9001");
    expect(a).toBe(b);
    expect(a).toBe('cannot read property <str> of undefined at index <num>');
  });
});
