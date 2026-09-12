/**
 * Which runtime produced this text?
 *
 * Both runtimes are scored rather than committing on the first match, because
 * a Node trace can contain the word "File" and a Python traceback can contain
 * the word "at". Whichever shape has more evidence wins; a tie or no evidence
 * returns null, and a null is a perfectly good outcome — the paste is stored
 * as a plain log.
 */

const NODE_FRAME = /^\s*at\s+\S/;
const PY_FRAME = /^\s*File\s+"[^"]+",\s+line\s+\d+/;
const PY_HEADER = /^Traceback \(most recent call last\):/m;

/**
 * @param {string} text
 * @returns {'node' | 'python' | null}
 */
export function detectRuntime(text) {
  if (typeof text !== 'string' || !text.trim()) return null;

  const lines = text.split('\n', 500);

  let node = 0;
  let python = 0;

  for (const line of lines) {
    if (NODE_FRAME.test(line)) node++;
    if (PY_FRAME.test(line)) python++;
  }

  // The header is strong evidence — it is unambiguous and Node never emits it.
  if (PY_HEADER.test(text)) python += 3;

  if (node === 0 && python === 0) return null;
  if (python > node) return 'python';
  if (node > python) return 'node';
  return null;
}
