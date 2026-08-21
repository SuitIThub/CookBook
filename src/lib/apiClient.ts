/**
 * Typed HTTP client for reading data from the app's own REST API.
 *
 * Purpose: keep the view layer (Astro pages/components) off direct `db` access.
 * Pages fetch through this client instead of importing `../lib/database`, which
 * establishes a hard frontend/backend boundary and makes the API base URL
 * configurable — the groundwork for the standalone app (local vs. server).
 *
 * Base URL resolution (first hit wins):
 *   1. import.meta.env.PUBLIC_API_BASE_URL  — explicit override
 *   2. the current request's origin           — SSR self-fetch (default)
 *   3. import.meta.env.PUBLIC_SITE_URL        — last-resort fallback
 *
 * In SSR frontmatter, pass `Astro` (anything with a `url`) so the client can
 * derive the origin of the in-flight request.
 */

export interface RequestOrigin {
  /** The in-flight request URL; `Astro` satisfies this in page frontmatter. */
  url: URL;
}

/** Resolve the API base URL (no trailing slash). */
export function resolveApiBaseUrl(context?: RequestOrigin): string {
  const explicit = import.meta.env.PUBLIC_API_BASE_URL;
  if (typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim().replace(/\/+$/, '');
  }

  if (context?.url) {
    return context.url.origin;
  }

  const site = import.meta.env.PUBLIC_SITE_URL;
  if (typeof site === 'string' && site.trim()) {
    return site.trim().replace(/\/+$/, '');
  }

  // Client-side (browser) fetches can use a relative path against same-origin.
  return '';
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

/**
 * GET a JSON resource from the API.
 *
 * @param path    API path beginning with `/api/...`.
 * @param context Pass `Astro` in SSR so the origin can be derived.
 * @throws ApiError on a non-2xx response.
 */
export async function apiGet<T>(path: string, context?: RequestOrigin): Promise<T> {
  const base = resolveApiBaseUrl(context);
  const target = base ? `${base}${path}` : path;

  const response = await fetch(target, {
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    throw new ApiError(
      `GET ${path} failed with ${response.status}`,
      response.status,
      path
    );
  }

  return (await response.json()) as T;
}
