/**
 * App settings, persisted in localStorage and read at runtime by the API client.
 * The server endpoint is user-configurable (entered in the Settings screen), and
 * the alias/token unlock write capability (no token → read-only).
 */
export const SERVER_URL_KEY = 'kochbuch.server.url';
export const ALIAS_KEY = 'kochbuch.alias';
export const TOKEN_KEY = 'kochbuch.token';

export interface AppSettings {
  serverUrl: string;
  alias: string;
  token: string;
}

function read(key: string): string {
  try {
    return (localStorage.getItem(key) || '').trim();
  } catch {
    return '';
  }
}

/** Configured server base URL (no trailing slash), or '' to use the build default. */
export function getServerUrl(): string {
  return read(SERVER_URL_KEY).replace(/\/+$/, '');
}
export function getAlias(): string {
  return read(ALIAS_KEY);
}
export function getToken(): string {
  return read(TOKEN_KEY);
}

export function getSettings(): AppSettings {
  return { serverUrl: getServerUrl(), alias: getAlias(), token: getToken() };
}

export function saveSettings(s: AppSettings): void {
  const set = (k: string, v: string) => {
    const t = (v || '').trim();
    if (t) localStorage.setItem(k, t);
    else localStorage.removeItem(k);
  };
  set(SERVER_URL_KEY, s.serverUrl.replace(/\/+$/, ''));
  set(ALIAS_KEY, s.alias);
  set(TOKEN_KEY, s.token);
}
