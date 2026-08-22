/**
 * Typed HTTP client for the Kochbuch server API.
 *
 * Base URL is resolved at runtime: the user-configured server (Settings) wins,
 * else the build-time VITE_API_BASE_URL, else '' (relative → Vite proxy in the
 * browser). Alias + token from Settings are attached as X-Alias / X-Auth-Token
 * so writes are authorized (no token → server allows reads only).
 */
import { getServerUrl, getAlias, getToken } from './settings';

function apiBase(): string {
  const configured = getServerUrl();
  if (configured) return configured;
  return (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const alias = getAlias();
  const token = getToken();
  if (alias) headers['X-Alias'] = alias;
  if (token) headers['X-Auth-Token'] = token;
  return headers;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { Accept: 'application/json', ...authHeaders() }
  });
  if (!res.ok) {
    throw new ApiError(`GET ${path} failed with ${res.status}`, res.status, path);
  }
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders() },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    // Surface the server's error message (e.g. import/auth failures) when present.
    let msg = `POST ${path} failed with ${res.status}`;
    try {
      const j: any = await res.json();
      if (j?.userMessage || j?.error) msg = j.userMessage || j.error;
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(msg, res.status, path);
  }
  return (await res.json()) as T;
}

/** Resolve a server asset path (e.g. /uploads/x.jpg) against the API base. */
export function assetUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  return `${apiBase()}${path}`;
}
