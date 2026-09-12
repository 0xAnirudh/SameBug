/**
 * Strip everything that varies between two occurrences of the same bug.
 *
 * ORDER MATTERS and is the whole design. Specific patterns run before general
 * ones — if the bare-number rule ran first it would shred UUIDs, timestamps
 * and hex addresses into <num> fragments before anything could recognise them.
 *
 * Each rule is exported for its own unit test, because a regex you cannot test
 * in isolation is a regex you cannot trust.
 */

export const RULES = [
  {
    name: 'timestamp',
    // ISO-8601, with or without fractional seconds and offset.
    pattern: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    replacement: '<ts>',
  },
  {
    name: 'uuid',
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    replacement: '<uuid>',
  },
  {
    name: 'objectid',
    // Exactly 24 hex — a Mongo ObjectId. Runs before the generic hash rule.
    pattern: /\b[0-9a-f]{24}\b/gi,
    replacement: '<oid>',
  },
  {
    name: 'address',
    pattern: /\b0x[0-9a-f]+\b/gi,
    replacement: '<addr>',
  },
  {
    name: 'url',
    // Before the path rule, because a URL contains slashes too.
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>)]+/gi,
    replacement: '<url>',
  },
  {
    name: 'ip',
    pattern: /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
    replacement: '<ip>',
  },
  {
    name: 'email',
    pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
    replacement: '<email>',
  },
  {
    name: 'path',
    // Two or more segments so a lone "/tmp" or a division stays put.
    pattern: /(?:[A-Za-z]:)?(?:[/\\][\w.@+-]+){2,}[/\\]?/g,
    replacement: '<path>',
  },
  {
    name: 'quoted',
    pattern: /'[^']*'|"[^"]*"|`[^`]*`/g,
    replacement: '<str>',
  },
  {
    name: 'hash',
    // Long hex or base64 runs: tokens, digests, request ids.
    pattern: /\b(?:[0-9a-f]{16,}|[A-Za-z0-9+/]{24,}={0,2})\b/gi,
    replacement: '<hash>',
  },
  {
    name: 'number',
    // Last of the substitutions, deliberately.
    pattern: /\b\d+(?:\.\d+)?\b/g,
    replacement: '<num>',
  },
];

/**
 * @param {string} message
 * @returns {string}
 */
export function normalizeMessage(message) {
  if (!message) return '';

  let out = message;
  for (const { pattern, replacement } of RULES) {
    // Fresh lastIndex each time; these are module-level /g regexes.
    pattern.lastIndex = 0;
    out = out.replace(pattern, replacement);
  }

  return out.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Applies a single rule. Exported so each one can be tested on its own. */
export function applyRule(name, input) {
  const rule = RULES.find((r) => r.name === name);
  if (!rule) throw new Error(`No normalization rule named ${name}`);
  rule.pattern.lastIndex = 0;
  return input.replace(rule.pattern, rule.replacement);
}
