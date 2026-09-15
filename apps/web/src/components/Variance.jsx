/**
 * "Seen 4 times" is a number. This is the diagnostic: what these occurrences
 * have in common, and exactly which parts of them differ.
 */
export function Variance({ data }) {
  if (!data || data.occurrences === 0) return null;

  const { shared, varying, occurrences, sampled, capped, note } = data;

  return (
    <div className="card variance">
      <h2 style={{ marginBottom: 6 }}>What differs</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 14px' }}>
        Compared across {sampled} of {occurrences === sampled ? 'the' : ''} {occurrences} parsed
        occurrence{occurrences === 1 ? '' : 's'}
        {capped ? ' (most recent)' : ''}.
      </p>

      <h4 className="var-head">Shared by all</h4>
      <ul className="var-shared">
        {shared.map((frame, i) => (
          <li key={i}>
            <span className="fn">{frame.function}</span>
            <span className="loc">{frame.file}</span>
            {i < shared.length - 1 && <span className="arrow">called from</span>}
          </li>
        ))}
      </ul>

      {note && <p className="var-note">{note}</p>}

      {varying.length > 0 && (
        <>
          <h4 className="var-head">Varies between them</h4>
          <ul className="var-list">
            {varying.map((item, i) => (
              <li key={i}>
                <div className="var-label">
                  <strong>{item.field}</strong>
                  {item.frame && <span className="var-where">in {item.frame}</span>}
                  {item.token && <code>{item.token}</code>}
                  <span className="var-count">
                    {item.distinct} value{item.distinct === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="var-values">
                  {item.values.map((value, j) => (
                    <span className="var-value" key={j}>
                      {value}
                    </span>
                  ))}
                  {item.distinct > item.values.length && (
                    <span className="var-more">+{item.distinct - item.values.length} more</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
