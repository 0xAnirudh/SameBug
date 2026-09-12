/**
 * CPython traceback parser.
 *
 *   Traceback (most recent call last):
 *     File "/srv/app/user.py", line 42, in get_user
 *       return cache[user_id]
 *   KeyError: 'user_42'
 *
 * Chained exceptions produce more than one traceback block. The one that
 * matters is the LAST — that is the exception that actually escaped; the
 * earlier blocks are what it was raised from.
 */

const FRAME = /^\s*File\s+"(.+?)",\s+line\s+(\d+)(?:,\s+in\s+(.+?))?\s*$/;
const HEADER = /^Traceback \(most recent call last\):\s*$/;
const CHAIN =
  /^(?:During handling of the above exception|The above exception was the direct cause)/;

/**
 * @param {string} text
 * @returns {{ runtime: 'python', errorType: string, message: string, frames: Array<{file:string,line:number,col:number,function:string}> } | null}
 */
export function parsePython(text) {
  const lines = text.split('\n');

  // Find where the last traceback block starts.
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (HEADER.test(lines[i]) || CHAIN.test(lines[i].trim())) start = i;
  }

  const block = lines.slice(start);
  const frames = [];

  for (const line of block) {
    const match = FRAME.exec(line);
    if (!match) continue;

    frames.push({
      file: match[1],
      line: Number(match[2]),
      // Python frames carry no column; 3.11+ underlines instead.
      col: 0,
      function: (match[3] ?? '<module>').trim(),
    });
  }

  if (frames.length === 0) return null;

  const { errorType, message } = parseErrorLine(block);
  return { runtime: 'python', errorType, message, frames };
}

/**
 * The exception line is the last unindented line of the block. Source echoes
 * and 3.11 caret underlines are indented, which is what separates them.
 */
function parseErrorLine(block) {
  for (let i = block.length - 1; i >= 0; i--) {
    const line = block[i];
    if (!line.trim() || /^\s/.test(line)) continue;

    const match = /^([A-Za-z_][\w.]*)\s*(?::\s*([\s\S]*))?$/.exec(line.trim());
    if (match) return { errorType: shortName(match[1]), message: (match[2] ?? '').trim() };
  }
  return { errorType: 'Exception', message: '' };
}

/** builtins.KeyError and KeyError are the same error. */
function shortName(name) {
  const parts = name.split('.');
  return parts[parts.length - 1];
}
