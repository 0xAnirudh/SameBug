import { createHash } from 'node:crypto';

/** Basename without pulling in path, which would differ on Windows separators. */
export function basename(file) {
  const parts = String(file).split(/[/\\]/);
  return parts[parts.length - 1] || file;
}

/**
 * Note what is deliberately absent from the hash input.
 *
 * No line numbers: adding an import at the top of a file shifts every line
 * below it, and the same bug must still group after an unrelated edit.
 * No absolute paths, only basenames: /home/ani/app/user.js and
 * /srv/prod/app/user.js are the same file. No columns, no timestamps.
 *
 * Sixteen hex characters is 64 bits. By the birthday bound the first expected
 * collision is around four billion distinct signatures — several orders of
 * magnitude past anything this system will hold.
 *
 * @param {{ errorType: string, normalizedMessage: string, significant: Array<{file:string,function:string}> }} input
 */
export function fingerprintHash({ errorType, normalizedMessage, significant }) {
  const topFrames = significant
    .slice(0, 3)
    .map((f) => `${basename(f.file)}:${f.function}`)
    .join('|');

  return createHash('sha1')
    .update(`${errorType}|${normalizedMessage}|${topFrames}`)
    .digest('hex')
    .slice(0, 16);
}
