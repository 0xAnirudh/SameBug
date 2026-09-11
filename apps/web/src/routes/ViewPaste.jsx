import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { CodeMirror } from '../components/CodeMirror.jsx';
import { CopyLink } from '../components/CopyLink.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../api/client.js';

function expiryLabel(expiresAt) {
  if (!expiresAt) return 'never expires';

  const ms = new Date(expiresAt) - Date.now();
  if (ms <= 0) return 'expired';

  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return `expires in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (hours < 48) return `expires in ${hours}h`;
  return `expires in ${Math.round(hours / 24)}d`;
}

export function ViewPaste() {
  const { slug } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [paste, setPaste] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setPaste(null);
    setError(null);

    api
      .getPaste(slug, controller.signal)
      .then((res) => setPaste(res.paste))
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      });

    return () => controller.abort();
  }, [slug]);

  if (error) {
    return (
      <div className="empty">
        <p style={{ margin: 0 }}>{error}</p>
        <p style={{ marginTop: 12 }}>
          <Link to="/">Create a new paste</Link>
        </p>
      </div>
    );
  }

  if (!paste) return <div className="empty">Loading…</div>;

  const isOwner = user && paste.authorId && String(paste.authorId) === String(user._id ?? user.id);

  async function remove() {
    if (!confirm('Delete this paste? This cannot be undone.')) return;
    try {
      await api.deletePaste(slug);
      navigate('/mine');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <article>
      <h1>{paste.title || 'Untitled paste'}</h1>

      <div className="meta">
        <span className="chip">{paste.language}</span>
        <span className="chip">{paste.kind}</span>
        {paste.fingerprint && (
          <Link className="chip accent" to={`/e/${paste.fingerprint}`}>
            grouped error
          </Link>
        )}
        <span>{paste.views} views</span>
        <span>{expiryLabel(paste.expiresAt)}</span>
        <a href={`/api/pastes/${slug}/raw`} target="_blank" rel="noreferrer">
          raw
        </a>
        {isOwner && (
          <button className="link" onClick={remove} style={{ color: 'var(--danger)' }}>
            Delete
          </button>
        )}
      </div>

      <CodeMirror value={paste.content} language={paste.language} readOnly minHeight={260} />

      <div style={{ marginTop: 14 }}>
        <CopyLink url={window.location.href} />
      </div>
    </article>
  );
}
