import { defineMiddleware } from 'astro:middleware';
import { validateAuth } from './lib/database.server';

const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Alias, X-Auth-Token',
    'Access-Control-Max-Age': '86400'
  };
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request } = context;
  const url = new URL(request.url);
  const origin = request.headers.get('origin');

  if (url.pathname.startsWith('/api/')) {
    // CORS preflight (the app calls the API cross-origin from the WebView).
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Write gating: GET/HEAD are open (read-only capability without a token);
    // state-changing methods require a valid per-alias token.
    if (WRITE_METHODS.has(request.method)) {
      const alias = request.headers.get('x-alias') || '';
      const token = request.headers.get('x-auth-token') || '';
      if (!validateAuth(alias, token)) {
        return new Response(
          JSON.stringify({ error: 'A valid token is required for write operations' }),
          { status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
        );
      }
    }

    const response = await next();
    for (const [k, v] of Object.entries(corsHeaders(origin))) response.headers.set(k, v);
    return response;
  }

  const response = await next();
  // Keep recipe HTML/JS/CSS out of browser and PWA HTTP caches.
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
  }
  return response;
});
