/**
 * Typed HTTP client for the Kochbuch server API.
 *
 * On a native platform (Capacitor) API calls go through the native HTTP stack
 * (CapacitorHttp) instead of the WebView's fetch. This is deliberate: the app
 * talks to a plain-HTTP LAN server with custom auth headers (X-Alias /
 * X-Auth-Token), which in the WebView triggers CORS preflight + cleartext/
 * mixed-content checks that can silently block every request. The native stack
 * bypasses all of that. We do NOT patch global fetch (the sql.js wasm and image
 * loads must keep using the WebView), so only these helpers are affected.
 *
 * Every request has a timeout so a stalled/unreachable server surfaces an error
 * instead of an endless spinner.
 *
 * Base URL: the user-configured server (Settings) wins, else VITE_API_BASE_URL,
 * else '' (relative → dev proxy in the browser).
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getServerUrl, getAlias, getToken } from './settings';

const DEFAULT_TIMEOUT_MS = 15000;

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

const native = () => Capacitor.isNativePlatform();

function withTimeout<T>(p: Promise<T>, ms: number, path: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ApiError(`Zeitüberschreitung (${ms} ms) bei ${path}`, 0, path)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

interface Raw {
  status: number;
  body: unknown; // parsed JSON when possible, else string
}

/** One request via the native HTTP stack (Capacitor) or the WebView (web). */
async function raw(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  opts: { json?: unknown; timeoutMs?: number } = {}
): Promise<Raw> {
  const url = `${apiBase()}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json', ...authHeaders() };
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (native()) {
    const req = CapacitorHttp.request({
      url,
      method,
      headers,
      data: opts.json,
      responseType: 'json',
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs
    });
    let res;
    try {
      res = await withTimeout(req, timeoutMs, path);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(`Netzwerkfehler bei ${path}: ${(e as Error).message}`, 0, path);
    }
    let body: unknown = res.data;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* leave as string */
      }
    }
    return { status: res.status, body };
  }

  // Web (dev/browser): WebView fetch with an AbortController timeout.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
      signal: ctrl.signal
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* leave as string */
    }
    return { status: res.status, body };
  } catch (e) {
    if (ctrl.signal.aborted) throw new ApiError(`Zeitüberschreitung (${timeoutMs} ms) bei ${path}`, 0, path);
    throw new ApiError(`Netzwerkfehler bei ${path}: ${(e as Error).message}`, 0, path);
  } finally {
    clearTimeout(timer);
  }
}

function extractError(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const j = body as any;
    if (j.userMessage || j.error) return j.userMessage || j.error;
  }
  return fallback;
}

export async function apiGet<T>(path: string, opts?: { timeoutMs?: number }): Promise<T> {
  const r = await raw('GET', path, { timeoutMs: opts?.timeoutMs });
  if (r.status < 200 || r.status >= 300) throw new ApiError(`GET ${path} failed with ${r.status}`, r.status, path);
  return r.body as T;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await raw('POST', path, { json: body });
  if (r.status < 200 || r.status >= 300) throw new ApiError(extractError(r.body, `POST ${path} failed with ${r.status}`), r.status, path);
  return r.body as T;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const r = await raw('PUT', path, { json: body });
  if (r.status < 200 || r.status >= 300) throw new ApiError(extractError(r.body, `PUT ${path} failed with ${r.status}`), r.status, path);
  return r.body as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const r = await raw('DELETE', path);
  if (r.status < 200 || r.status >= 300) throw new ApiError(extractError(r.body, `DELETE ${path} failed with ${r.status}`), r.status, path);
  return r.body as T;
}

/**
 * Multipart upload (e.g. recipe/product images). CapacitorHttp doesn't handle
 * FormData, so this always uses the WebView fetch — online-only and best-effort.
 */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, { method: 'POST', headers: { Accept: 'application/json', ...authHeaders() }, body: form });
  if (!res.ok) {
    let msg = `POST ${path} failed with ${res.status}`;
    try {
      const j: any = await res.json();
      msg = j?.userMessage || j?.error || msg;
    } catch {
      /* ignore */
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
