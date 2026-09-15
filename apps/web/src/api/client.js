/**
 * The access token lives in a module variable, not localStorage. It survives a
 * route change but not a reload — on reload we ask the refresh cookie for a new
 * one. An XSS can still read this, but it cannot read it off disk after the tab
 * closes, and the refresh token it would actually want is httpOnly.
 */
let accessToken = null;
let refreshPromise = null;
const listeners = new Set();

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token) {
  accessToken = token;
  listeners.forEach((fn) => fn(token));
}

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function send(path, { method = 'GET', body, headers = {}, signal } = {}) {
  return fetch(path, {
    method,
    credentials: 'include',
    signal,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * Single-flight refresh.
 *
 * Three requests failing 401 at the same moment must produce ONE refresh, not
 * three. Three refreshes would rotate the token three times and two of them
 * would lose the race, logging the user out for no reason. Every caller awaits
 * the same promise.
 */
function refreshOnce() {
  refreshPromise ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) {
        setAccessToken(null);
        throw new ApiError(401, 'SESSION_ENDED', 'Your session ended');
      }
      const data = await res.json();
      setAccessToken(data.accessToken);
      return data;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

async function parse(res) {
  if (res.status === 204) return null;

  const type = res.headers.get('content-type') ?? '';
  const payload = type.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const err = payload?.error ?? {};
    throw new ApiError(
      res.status,
      err.code ?? 'UNKNOWN',
      err.message ?? 'Something went wrong',
      err.details
    );
  }
  return payload;
}

export async function request(path, options = {}) {
  let res = await send(path, options);

  const refreshable = res.status === 401 && !options.noRetry && !path.includes('/auth/refresh');
  if (refreshable) {
    try {
      await refreshOnce();
      res = await send(path, options);
    } catch {
      // Refresh failed — fall through and report the original 401.
    }
  }

  return parse(res);
}

/**
 * Called once at boot. If a refresh cookie exists we come back signed in;
 * if not, this fails quietly and the app renders as anonymous.
 */
export async function restoreSession() {
  try {
    return await refreshOnce();
  } catch {
    return null;
  }
}

export const api = {
  register: (email, password) =>
    request('/api/auth/register', { method: 'POST', body: { email, password } }),
  login: (email, password) =>
    request('/api/auth/login', { method: 'POST', body: { email, password } }),
  logout: (all = false) =>
    request(`/api/auth/logout${all ? '?all=true' : ''}`, { method: 'POST', noRetry: true }),
  me: () => request('/api/auth/me'),

  createPaste: (paste) => request('/api/pastes', { method: 'POST', body: paste }),
  getPaste: (slug, signal) => request(`/api/pastes/${slug}`, { signal }),
  deletePaste: (slug) => request(`/api/pastes/${slug}`, { method: 'DELETE' }),
  errorGroup: (fp, signal) => request(`/api/errors/${fp}`, { signal }),
  variance: (fp, signal) => request(`/api/errors/${fp}/variance`, { signal }),
  occurrences: (fp, { cursor, limit = 20 } = {}) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (cursor) qs.set('cursor', cursor);
    return request(`/api/errors/${fp}/occurrences?${qs}`);
  },

  myPastes: ({ cursor, limit = 20 } = {}) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (cursor) qs.set('cursor', cursor);
    return request(`/api/me/pastes?${qs}`);
  },
};
