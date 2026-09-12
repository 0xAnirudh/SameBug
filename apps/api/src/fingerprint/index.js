import { detectRuntime } from './detect.js';
import { parseNode } from './parsers/node.js';
import { parsePython } from './parsers/python.js';
import { normalizeMessage } from './normalize.js';
import { classifyFrames } from './classify.js';
import { fingerprintHash, basename } from './hash.js';

/**
 * @typedef {object} Fingerprinted
 * @property {string} fingerprint
 * @property {'node'|'python'} runtime
 * @property {string} errorType
 * @property {string} message
 * @property {string} normalizedMessage
 * @property {Array<{file:string,line:number,col:number,function:string,isApp:boolean}>} frames
 * @property {boolean} allFramesAreVendor
 * @property {string} topFrame
 */

/**
 * The whole pipeline. Pure: no database, no network, no Express.
 *
 * Returns null for anything that is not a recognisable stack trace, and never
 * throws — an unparseable paste is a normal outcome, not an error.
 *
 * @param {string} text
 * @returns {Fingerprinted | null}
 */
export function fingerprint(text) {
  try {
    const runtime = detectRuntime(text);
    if (!runtime) return null;

    const parsed = runtime === 'python' ? parsePython(text) : parseNode(text);
    if (!parsed || parsed.frames.length === 0) return null;

    const normalizedMessage = normalizeMessage(parsed.message);
    const { frames, significant, allFramesAreVendor } = classifyFrames(parsed.frames, runtime);

    const top = significant[0];

    return {
      fingerprint: fingerprintHash({
        errorType: parsed.errorType,
        normalizedMessage,
        significant,
      }),
      runtime,
      errorType: parsed.errorType,
      message: parsed.message,
      normalizedMessage,
      frames,
      allFramesAreVendor,
      topFrame: top ? `${basename(top.file)}:${top.function}` : '',
    };
  } catch {
    // A malformed paste must never take down a create request.
    return null;
  }
}

export { detectRuntime, normalizeMessage, classifyFrames, fingerprintHash };
