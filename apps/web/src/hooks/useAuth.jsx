import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, onAuthChange, restoreSession, setAccessToken } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // "Do we know yet?" is a third state, distinct from signed-out. Rendering a
  // signed-out header for a split second on every reload looks broken.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;

    restoreSession()
      .then((session) => alive && setUser(session?.user ?? null))
      .finally(() => alive && setReady(true));

    // If a token is dropped anywhere (a failed refresh), reflect it here.
    const off = onAuthChange((token) => {
      if (!token && alive) setUser(null);
    });

    return () => {
      alive = false;
      off();
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      async signIn(email, password) {
        const res = await api.login(email, password);
        setAccessToken(res.accessToken);
        setUser(res.user);
      },
      async signUp(email, password) {
        const res = await api.register(email, password);
        setAccessToken(res.accessToken);
        setUser(res.user);
      },
      async signOut() {
        await api.logout().catch(() => {});
        setAccessToken(null);
        setUser(null);
      },
    }),
    [user, ready]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
