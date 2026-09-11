import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CodeMirror } from '../components/CodeMirror.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../api/client.js';

const LANGUAGES = ['plaintext', 'javascript', 'typescript', 'python', 'json'];

export function NewPaste() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('plaintext');
  const [expiry, setExpiry] = useState('never');
  const [visibility, setVisibility] = useState('public');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const { paste } = await api.createPaste({
        content,
        title: title.trim() || undefined,
        language,
        expiry,
        visibility,
      });
      navigate(`/p/${paste.slug}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>New paste</h1>
      <p className="lede">
        Paste a snippet or an error. Stack traces get parsed and grouped with every other
        occurrence of the same bug.
      </p>

      {error && <div className="notice error">{error}</div>}

      <CodeMirror value={content} onChange={setContent} language={language} minHeight={340} />

      <div className="row" style={{ marginTop: 14 }}>
        <div className="field" style={{ flex: '2 1 220px' }}>
          <label htmlFor="title">Title (optional)</label>
          <input
            id="title"
            type="text"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="TypeError in checkout handler"
          />
        </div>

        <div className="field">
          <label htmlFor="language">Language</label>
          <select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="expiry">Expires</label>
          <select id="expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            <option value="never">never</option>
            <option value="1h">in 1 hour</option>
            <option value="1d">in 1 day</option>
            <option value="1w">in 1 week</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="visibility">Visibility</label>
          <select
            id="visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
            <option value="public">public</option>
            <option value="unlisted">unlisted</option>
            <option value="private" disabled={!user}>
              private {user ? '' : '— sign in'}
            </option>
          </select>
        </div>

        <button type="submit" disabled={saving || !content.trim()}>
          {saving ? 'Saving…' : 'Create paste'}
        </button>
      </div>

      {/* Said up front, because finding out afterwards is the annoying version. */}
      {!user && (
        <p className="lede" style={{ marginTop: 12, fontSize: 13 }}>
          You are not signed in, so this paste will have no owner and cannot be deleted. Give it an
          expiry if that matters.
        </p>
      )}
    </form>
  );
}
