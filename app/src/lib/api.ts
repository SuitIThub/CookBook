/**
 * Typed HTTP client for the Kochbuch server API.
 *
 * Base URL: VITE_API_BASE_URL when set (device/APK build → absolute server URL),
 * otherwise empty → relative /api paths that Vite proxies to the Astro dev
 * server in the browser. Phase 1 is remote-only; a local replica + sync layer
 * will slot in behind this client later (see APP_PLAN.md).
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

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
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' }
  });
  if (!res.ok) {
    throw new ApiError(`GET ${path} failed with ${res.status}`, res.status, path);
  }
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new ApiError(`POST ${path} failed with ${res.status}`, res.status, path);
  }
  return (await res.json()) as T;
}

/** Resolve a server asset path (e.g. /uploads/x.jpg) against the API base. */
export function assetUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path}`;
}
