/**
 * Application frames versus library frames.
 *
 * This is the load-bearing idea of the whole engine: library frames differ
 * between users, application frames identify the bug. A TypeError thrown from
 * inside Express tells you nothing — half the internet has that frame. The
 * first frame in *your* code tells you everything.
 */

const NODE_VENDOR = [
  /[/\\]node_modules[/\\]/,
  /^node:/,
  /^internal[/\\]/,
  /^<anonymous>$/,
  /[/\\]\.next[/\\]/,
  /[/\\]\.nuxt[/\\]/,
];

const PYTHON_VENDOR = [
  /[/\\]site-packages[/\\]/,
  /[/\\]dist-packages[/\\]/,
  /[/\\]lib[/\\]python\d[.\d]*[/\\]/,
  /^<frozen\s/,
  /^[/\\]usr[/\\]lib[/\\]python/,
];

/**
 * @param {{file: string}} frame
 * @param {'node' | 'python'} runtime
 */
export function isVendorFrame(frame, runtime) {
  const patterns = runtime === 'python' ? PYTHON_VENDOR : NODE_VENDOR;
  return patterns.some((p) => p.test(frame.file));
}

/**
 * Tags every frame, then picks the ones that identify the bug.
 *
 * The edge case worth knowing about: a crash entirely inside a library leaves
 * zero application frames, and filtering would leave nothing to hash. In that
 * case fall back to the top frames overall and say so, rather than silently
 * producing a fingerprint from an empty list.
 *
 * @returns {{ frames: Array<object>, significant: Array<object>, allFramesAreVendor: boolean }}
 */
export function classifyFrames(rawFrames, runtime) {
  const frames = rawFrames.map((f) => ({ ...f, isApp: !isVendorFrame(f, runtime) }));

  const appFrames = frames.filter((f) => f.isApp);
  const allFramesAreVendor = appFrames.length === 0;

  return {
    frames,
    significant: allFramesAreVendor ? frames : appFrames,
    allFramesAreVendor,
  };
}
