/**
 * Application frames carry the identity of the bug; library frames are noise
 * that differs between users. The rendering says so: app frames are the ones
 * you read, vendor frames recede.
 */
export function FrameList({ frames, allFramesAreVendor }) {
  if (!frames?.length) return null;

  return (
    <div className="frames">
      {allFramesAreVendor && (
        <p className="frames-note">
          Every frame is library code, so all frames were used to identify this error.
        </p>
      )}

      <ol>
        {frames.map((frame, i) => (
          <li key={i} className={frame.isApp ? 'app' : 'vendor'}>
            <span className="fn">{frame.function}</span>
            <span className="loc">
              {frame.file}
              {frame.line ? `:${frame.line}` : ''}
              {frame.col ? `:${frame.col}` : ''}
            </span>
            {!frame.isApp && <span className="tagged">library</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
