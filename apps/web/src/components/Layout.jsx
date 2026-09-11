import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

export function Layout() {
  const { user, ready, signOut } = useAuth();

  return (
    <>
      <header className="top">
        <div className="bar">
          <Link className="brand" to="/">
            samebug
          </Link>
          <nav>
            <Link to="/">New paste</Link>
            {/* `ready` keeps the header from flashing signed-out on every reload. */}
            {ready && user && (
              <>
                <Link to="/mine">My pastes</Link>
                <span className="who">{user.email}</span>
                <button className="link" onClick={signOut}>
                  Sign out
                </button>
              </>
            )}
            {ready && !user && <Link to="/signin">Sign in</Link>}
          </nav>
        </div>
      </header>
      <main className="shell">
        <Outlet />
      </main>
    </>
  );
}
