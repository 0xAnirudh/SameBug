/**
 * V8 stack trace parser.
 *
 * The shapes that actually occur, each of which has a fixture:
 *   at fnName (/srv/app/user.js:42:15)
 *   at /srv/app/user.js:42:15                  — no function name
 *   at async fnName (/srv/app/user.js:42:15)
 *   at new ClassName (/srv/app/user.js:42:15)
 *   at Object.<anonymous> (/srv/app/index.js:1:1)
 *   at Module._compile (node:internal/modules/cjs/loader:1105:14)
 *   at file:///srv/app/user.js:42:15           — ESM URL
 *   at C:\srv\app\user.js:42:15                — Windows
 */

const FRAME = /^\s*at\s+(?:(.+?)\s+\()?([^()]+?)\)?\s*$/;
// Non-greedy file, anchored line:col, so a Windows "C:\..." keeps its drive.
const LOCATION = /^(.*?):(\d+):(\d+)$/;

/**
 * @param {string} text
 * @returns {{ runtime: 'node', errorType: string, message: string, frames: Array<{file:string,line:number,col:number,function:string}> } | null}
 */
export function parseNode(text) {
  const lines = text.split('\n');

  const frames = [];
  let firstFrameIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const match = FRAME.exec(lines[i]);
    if (!match) continue;

    const [, rawFn, rawLoc] = match;
    const loc = LOCATION.exec(rawLoc.trim());
    if (!loc) continue; // e.g. "at <anonymous>" with no location

    if (firstFrameIndex === -1) firstFrameIndex = i;

    frames.push({
      file: normalizeFile(loc[1]),
      line: Number(loc[2]),
      col: Number(loc[3]),
      function: cleanFunction(rawFn),
    });
  }

  if (frames.length === 0) return null;

  const { errorType, message } = parseHeader(lines.slice(0, firstFrameIndex));
  return { runtime: 'node', errorType, message, frames };
}

function normalizeFile(file) {
  // ESM frames carry a file:// URL; the path is what identifies the code.
  if (file.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(file).pathname);
    } catch {
      return file;
    }
  }
  return file;
}

function cleanFunction(raw) {
  if (!raw) return '<anonymous>';
  // "async foo" and "new Foo" are call-site decoration, not identity.
  return raw.replace(/^async\s+/, '').trim() || '<anonymous>';
}

/**
 * The header is everything above the first frame. Multi-line messages happen,
 * so take the last line that looks like "Type: message" — that is the error
 * itself rather than a line of preamble.
 */
function parseHeader(headerLines) {
  const candidates = headerLines.map((l) => l.trim()).filter(Boolean);

  for (let i = candidates.length - 1; i >= 0; i--) {
    const match = /^([A-Za-z_$][\w$.]*(?:Error|Exception|Warning)[\w$]*)\s*:\s*([\s\S]*)$/.exec(
      candidates[i]
    );
    if (match) return { errorType: match[1], message: match[2].trim() };
  }

  // No recognisable "SomethingError:" line — fall back to a leading Type: msg.
  const last = candidates[candidates.length - 1] ?? '';
  const colon = last.indexOf(':');
  if (colon > 0 && !last.slice(0, colon).includes(' ')) {
    return { errorType: last.slice(0, colon), message: last.slice(colon + 1).trim() };
  }

  return { errorType: 'Error', message: last };
}
