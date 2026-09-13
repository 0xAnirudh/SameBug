import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';

function ago(date) {
  const seconds = Math.round((Date.now() - new Date(date)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function ErrorGroup() {
  const { fp } = useParams();

  const [group, setGroup] = useState(null);
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setGroup(null);
    setError(null);

    api
      .errorGroup(fp, controller.signal)
      .then((res) => setGroup(res.group))
      .then(() => api.occurrences(fp, { limit: 20 }))
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      });

    return () => controller.abort();
  }, [fp]);

  async function more() {
    setLoading(true);
    try {
      const page = await api.occurrences(fp, { cursor, limit: 20 });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (error) return <div className="empty">{error}</div>;
  if (!group) return <div className="empty">Loading…</div>;

  return (
    <section>
      <h1>{group.errorType}</h1>
      <p className="lede" style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>
        {group.normalizedMessage}
      </p>

      <div className="meta">
        <span className="chip accent">
          seen {group.count} {group.count === 1 ? 'time' : 'times'}
        </span>
        <span className="chip">{group.runtime}</span>
        <span>first seen {ago(group.firstSeenAt)}</span>
        <span>last seen {ago(group.lastSeenAt)}</span>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 6 }}>Signature</h2>
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: '0 0 10px' }}>
          Two pastes share this group when their error type, their message with all variable parts
          removed, and their top three application frames all match.
        </p>
        <dl className="sig">
          <dt>fingerprint</dt>
          <dd>{group._id}</dd>
          <dt>top app frame</dt>
          <dd>{group.topFrame || '—'}</dd>
          <dt>normalized</dt>
          <dd>{group.normalizedMessage}</dd>
        </dl>
      </div>

      <h2>Occurrences</h2>
      <div className="list">
        {items.map((p) => (
          <div className="list-item" key={p.slug}>
            <Link to={`/p/${p.slug}`}>{p.title || p.slug}</Link>
            <span className="chip">{p.language}</span>
            <span className="grow" style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
              {ago(p.createdAt)}
            </span>
          </div>
        ))}
      </div>

      {cursor && (
        <div style={{ marginTop: 14 }}>
          <button className="ghost" disabled={loading} onClick={more}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </section>
  );
}
