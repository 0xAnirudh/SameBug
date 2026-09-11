import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

export function SignIn() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const registering = mode === 'register';

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await (registering ? signUp(email, password) : signIn(email, password));
      navigate('/mine');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="center-narrow">
      <h1>{registering ? 'Create an account' : 'Sign in'}</h1>
      <p className="lede">
        An account lets you own pastes, delete them, and mark them private. Anonymous pasting works
        without one.
      </p>

      <form className="card" onSubmit={submit}>
        {error && <div className="notice error">{error}</div>}

        <div className="field" style={{ marginBottom: 12 }}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={registering ? 'new-password' : 'current-password'}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {registering && (
            <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>At least 8 characters.</span>
          )}
        </div>

        <button type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Working…' : registering ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p style={{ textAlign: 'center', marginTop: 14, fontSize: 13.5 }}>
        <button
          className="link"
          onClick={() => {
            setMode(registering ? 'signin' : 'register');
            setError(null);
          }}
        >
          {registering ? 'I already have an account' : 'Create an account instead'}
        </button>
      </p>
      <p style={{ textAlign: 'center', fontSize: 13.5 }}>
        <Link to="/">Paste without an account</Link>
      </p>
    </div>
  );
}
