import { LANGUAGES } from '../models/Paste.js';

/**
 * Deliberately crude. Five languages, a handful of signals, and plaintext when
 * nothing is obvious. Guessing wrong costs a user one dropdown change; getting
 * clever here costs days that belong to the fingerprint engine.
 *
 * @param {string} content
 * @returns {typeof LANGUAGES[number]}
 */
export function detectLanguage(content) {
  const head = content.slice(0, 4000);

  const trimmed = head.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Not JSON after all; fall through to the keyword checks.
    }
  }

  if (/^\s*(def|class)\s+\w+|^\s*(from|import)\s+\w+|:\s*$/m.test(head)) {
    if (/\bself\b|\bdef\b|\belif\b|\b__init__\b/.test(head)) return 'python';
  }

  if (/\binterface\s+\w+|\btype\s+\w+\s*=|:\s*(string|number|boolean)\b/.test(head)) {
    return 'typescript';
  }

  if (/\b(const|let|var|function|=>|require\(|module\.exports)\b/.test(head)) {
    return 'javascript';
  }

  return 'plaintext';
}

/**
 * Phase 3 placeholder. Phase 5 replaces this with the real parser, which sets
 * 'stacktrace' only when a trace actually parses.
 *
 * @param {string} content
 * @returns {'code' | 'log'}
 */
export function detectKind(content) {
  const lines = content.split('\n').slice(0, 200);
  if (lines.length < 3) return 'code';

  // Timestamped, levelled lines are the shape of a log file.
  const logLike = lines.filter((l) =>
    /^\s*(\[?\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2})|^\s*\[?(INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL)\b/i.test(
      l
    )
  ).length;

  return logLike / lines.length > 0.3 ? 'log' : 'code';
}
