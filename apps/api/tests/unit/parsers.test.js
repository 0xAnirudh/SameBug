import '../helpers/env.js';
import { describe, it, expect } from 'vitest';
import { detectRuntime } from '../../src/fingerprint/detect.js';
import { parseNode } from '../../src/fingerprint/parsers/node.js';
import { parsePython } from '../../src/fingerprint/parsers/python.js';
import { classifyFrames } from '../../src/fingerprint/classify.js';

describe('runtime detection', () => {
  it('recognises a Node trace', () => {
    expect(detectRuntime('Error: x\n    at f (/a/b.js:1:1)')).toBe('node');
  });

  it('recognises a Python traceback', () => {
    expect(
      detectRuntime('Traceback (most recent call last):\n  File "/a/b.py", line 1, in f\nKeyError: 1')
    ).toBe('python');
  });

  it('returns null for prose, which is a normal outcome', () => {
    expect(detectRuntime('the deploy failed again')).toBeNull();
    expect(detectRuntime('')).toBeNull();
    expect(detectRuntime(null)).toBeNull();
  });
});

describe('node parser', () => {
  it('parses every call-site shape V8 emits', () => {
    const parsed = parseNode(`TypeError: boom
    at getUser (/srv/app/user.js:42:15)
    at /srv/app/mw.js:20:3
    at async handleRequest (/srv/app/server.js:88:5)
    at new Connection (/srv/app/db.js:5:11)
    at Object.<anonymous> (/srv/app/index.js:10:1)
    at Module._compile (node:internal/modules/cjs/loader:1105:14)`);

    expect(parsed.errorType).toBe('TypeError');
    expect(parsed.message).toBe('boom');
    expect(parsed.frames).toHaveLength(6);

    expect(parsed.frames[0]).toMatchObject({ file: '/srv/app/user.js', line: 42, col: 15, function: 'getUser' });
    // No function name at the call site.
    expect(parsed.frames[1].function).toBe('<anonymous>');
    // "async" is call-site decoration, not part of the function's identity.
    expect(parsed.frames[2].function).toBe('handleRequest');
    expect(parsed.frames[3].function).toBe('new Connection');
    expect(parsed.frames[5].file).toBe('node:internal/modules/cjs/loader');
  });

  it('unwraps an ESM file:// frame to its path', () => {
    const parsed = parseNode(`Error: x\n    at boot (file:///home/ani/app/boot.js:9:3)`);
    expect(parsed.frames[0].file).toBe('/home/ani/app/boot.js');
  });

  it('keeps a Windows drive letter out of the line:col split', () => {
    const parsed = parseNode(`Error: x\n    at f (C:\\work\\app\\user.js:61:9)`);
    expect(parsed.frames[0]).toMatchObject({ file: 'C:\\work\\app\\user.js', line: 61, col: 9 });
  });

  it('returns null when there are no frames at all', () => {
    expect(parseNode('TypeError: boom')).toBeNull();
  });
});

describe('python parser', () => {
  it('ignores the source echo and the 3.11 caret underline', () => {
    const parsed = parsePython(`Traceback (most recent call last):
  File "/srv/app/user.py", line 42, in get_user
    return cache[user_id]
           ~~~~~^^^^^^^^^
KeyError: 'user_8821'`);

    expect(parsed.errorType).toBe('KeyError');
    expect(parsed.message).toBe("'user_8821'");
    expect(parsed.frames).toHaveLength(1);
    expect(parsed.frames[0]).toMatchObject({ file: '/srv/app/user.py', line: 42, function: 'get_user' });
  });

  // The earlier blocks are what it was raised from; the last one escaped.
  it('takes the last block of a chained traceback', () => {
    const parsed = parsePython(`Traceback (most recent call last):
  File "/srv/app/store.py", line 15, in fetch
    return self.cache[key]
KeyError: 'session:abc'

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "/srv/app/api.py", line 60, in load_session
    raise SessionMissing(key) from exc
SessionMissing: no session for 'abc'`);

    expect(parsed.errorType).toBe('SessionMissing');
    expect(parsed.frames).toHaveLength(1);
    expect(parsed.frames[0].file).toBe('/srv/app/api.py');
  });

  it('strips a module prefix — builtins.KeyError is KeyError', () => {
    const parsed = parsePython(`Traceback (most recent call last):
  File "/a/b.py", line 1, in f
builtins.KeyError: 'x'`);
    expect(parsed.errorType).toBe('KeyError');
  });
});

describe('frame classification', () => {
  it('separates application frames from library frames in Node', () => {
    const { frames, significant, allFramesAreVendor } = classifyFrames(
      [
        { file: '/srv/app/user.js' },
        { file: '/srv/app/node_modules/express/lib/router.js' },
        { file: 'node:internal/streams/readable' },
      ],
      'node'
    );

    expect(frames.map((f) => f.isApp)).toEqual([true, false, false]);
    expect(significant).toHaveLength(1);
    expect(allFramesAreVendor).toBe(false);
  });

  it('separates them in Python', () => {
    const { frames } = classifyFrames(
      [
        { file: '/srv/app/user.py' },
        { file: '/usr/lib/python3.12/site-packages/django/core.py' },
        { file: '<frozen importlib._bootstrap>' },
      ],
      'python'
    );
    expect(frames.map((f) => f.isApp)).toEqual([true, false, false]);
  });

  /**
   * A crash entirely inside a library leaves nothing to hash. Falling back to
   * the top frames overall beats producing a fingerprint from an empty list.
   */
  it('falls back to all frames when every frame is a library frame', () => {
    const { significant, allFramesAreVendor } = classifyFrames(
      [
        { file: 'node:internal/streams/readable' },
        { file: '/srv/app/node_modules/send/index.js' },
      ],
      'node'
    );

    expect(allFramesAreVendor).toBe(true);
    expect(significant).toHaveLength(2);
  });
});
