import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../api/client.js';

export function MyPastes() {
  const { user, ready } = useAuth();

  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (after) => {
    setLoading(true);
    try {
      const page = await api.myPastes({ cursor: after, limit: 20 });
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setDone(!page.nextCursor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready && user) load(undefined);
  }, [ready, user, load]);

  // Wait for the session restore before deciding — otherwise a reload bounces
  // a signed-in user to the sign-in screen.
  if (!ready) return <div className="empty">Loading…</div>;
  if (!user) return <Navigate to="/signin" replace />;

  return (
    <section>
      <h1>My pastes</h1>
      <p className="lede">Newest first.</p>

      {error && <div className="notice error">{error}</div>}

      {items.length === 0 && !loading && (
        <div className="empty">
          Nothing here yet. <Link to="/">Create your first paste.</Link>
        </div>
      )}

      {items.length > 0 && (
        <div className="list">
          {items.map((p) => (
            <div className="list-item" key={p.slug}>
              <Link to={`/p/${p.slug}`}>{p.title || p.slug}</Link>
              <span className="chip">{p.language}</span>
              {p.visibility !== 'public' && <span className="chip">{p.visibility}</span>}
              <span className="grow" style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                {new Date(p.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {!done && items.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button className="ghost" disabled={loading} onClick={() => load(cursor)}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </section>
  );
}
