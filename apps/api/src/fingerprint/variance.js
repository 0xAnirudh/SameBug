import { basename } from './hash.js';

/**
 * Turns "seen 4 times" into something diagnostic: what these occurrences have
 * in common, and exactly which parts of them differ.
 *
 * Pure, like the rest of this directory. It deliberately does not touch
 * normalize.js — changing normalization would change every fingerprint and
 * orphan every group already stored.
 *
 * The trick for recovering what was normalised away: every occurrence in a
 * group shares one normalizedMessage by construction. Turning that string back
 * into a regex — literals escaped, placeholders as capture groups — and running
 * it against each raw message extracts the values each placeholder stood for.
 */

const PLACEHOLDER = /(<(?:ts|uuid|oid|addr|url|ip|email|path|str|hash|num)>)/g;

/** What to call each placeholder in the UI. */
const LABELS = {
  '<ts>': 'timestamp',
  '<uuid>': 'UUID',
  '<oid>': 'object id',
  '<addr>': 'memory address',
  '<url>': 'URL',
  '<ip>': 'host',
  '<email>': 'email',
  '<path>': 'file path',
  '<str>': 'quoted value',
  '<hash>': 'token or digest',
  '<num>': 'number',
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** normalizeMessage() collapses whitespace before lowercasing; match that. */
const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Builds a matcher from a normalized message.
 * "cannot read property <str> of undefined" -> /^cannot read property (.*?) of undefined$/d
 */
function buildMatcher(normalizedMessage) {
  const parts = String(normalizedMessage ?? '').split(PLACEHOLDER);
  if (parts.length === 1) return null; // nothing was substituted

  const tokens = [];
  const source = parts
    .map((part) => {
      if (PLACEHOLDER.test(part)) {
        PLACEHOLDER.lastIndex = 0;
        tokens.push(part);
        return '(.*?)';
      }
      PLACEHOLDER.lastIndex = 0;
      return escapeRegex(part);
    })
    .join('');

  try {
    // The d flag gives match indices, so values can be sliced out of the
    // original-case string rather than the lowercased one used for matching.
    return { regex: new RegExp(`^${source}$`, 'd'), tokens };
  } catch {
    return null;
  }
}

/**
 * @param {string} rawMessage
 * @param {{regex: RegExp, tokens: string[]}} matcher
 * @returns {Array<{token: string, value: string}>}
 */
function extractValues(rawMessage, matcher) {
  const original = collapse(rawMessage);
  const match = matcher.regex.exec(original.toLowerCase());
  if (!match?.indices) return [];

  return matcher.tokens.map((token, i) => {
    const span = match.indices[i + 1];
    return { token, value: span ? original.slice(span[0], span[1]) : '' };
  });
}

/** Distinct values, order preserved, capped for display. */
function distinct(values, cap = 6) {
  const seen = [];
  for (const v of values) {
    if (v !== '' && v !== undefined && v !== null && !seen.includes(v)) seen.push(v);
  }
  return { total: seen.length, sample: seen.slice(0, cap) };
}

/** Everything before the filename — the part that differs per deployment. */
function directoryOf(file) {
  const cut = String(file).lastIndexOf(basename(file));
  return cut > 0 ? String(file).slice(0, cut).replace(/[/\\]$/, '') : '';
}

/**
 * @param {Array<{message: string, normalizedMessage: string, frames: Array<object>}>} occurrences
 */
export function analyzeVariance(occurrences) {
  const usable = (occurrences ?? []).filter((o) => o && Array.isArray(o.frames));

  if (usable.length === 0) {
    return { occurrences: 0, shared: [], varying: [], note: 'No parsed occurrences to compare.' };
  }

  const first = usable[0];

  /* ---- what they share: the app frames that define the group ---------- */
  const appFrames = (first.frames ?? []).filter((f) => f.isApp).slice(0, 3);
  const fallbackFrames = appFrames.length ? appFrames : (first.frames ?? []).slice(0, 3);

  const shared = fallbackFrames.map((f) => ({
    file: basename(f.file),
    function: f.function,
  }));

  const varying = [];

  /* ---- what varies inside the message --------------------------------- */
  const matcher = buildMatcher(first.normalizedMessage);
  if (matcher) {
    const perToken = matcher.tokens.map(() => []);

    for (const occurrence of usable) {
      extractValues(occurrence.message, matcher).forEach((extracted, i) => {
        perToken[i].push(extracted.value);
      });
    }

    perToken.forEach((values, i) => {
      const token = matcher.tokens[i];
      const { total, sample } = distinct(values);
      if (total > 1) {
        varying.push({
          kind: 'message',
          field: LABELS[token] ?? token,
          token,
          distinct: total,
          values: sample,
        });
      }
    });
  }

  /* ---- what varies inside the frames ---------------------------------- */
  fallbackFrames.forEach((frame, index) => {
    const dirs = [];
    const lines = [];

    for (const occurrence of usable) {
      const match = (occurrence.frames ?? [])[index];
      if (!match) continue;
      dirs.push(directoryOf(match.file));
      lines.push(match.line);
    }

    const dir = distinct(dirs);
    if (dir.total > 1) {
      varying.push({
        kind: 'frame',
        field: 'deployment path',
        frame: `${basename(frame.file)}:${frame.function}`,
        distinct: dir.total,
        values: dir.sample,
      });
    }

    const line = distinct(lines.map(String));
    if (line.total > 1) {
      varying.push({
        kind: 'frame',
        field: 'line number',
        frame: `${basename(frame.file)}:${frame.function}`,
        distinct: line.total,
        values: line.sample,
      });
    }
  });

  return {
    occurrences: usable.length,
    shared,
    varying,
    note:
      varying.length === 0
        ? 'These occurrences are identical in every field compared.'
        : undefined,
  };
}
