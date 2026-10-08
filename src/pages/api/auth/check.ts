import type { APIRoute } from 'astro';
import { validateAuth } from '../../../lib/database.server';
import { normalizeAlias } from '../../../lib/auth.server';

/**
 * Does the token in X-Auth-Token belong to the alias in X-Alias? Lets the
 * website/app tell the user right away (instead of every write failing with
 * 403 later). Reveals nothing beyond what a write attempt would.
 */
export const GET: APIRoute = async ({ request }) => {
  const alias = normalizeAlias(request.headers.get('x-alias'));
  const token = request.headers.get('x-auth-token') || '';
  return new Response(JSON.stringify({ alias, hasToken: !!token, valid: !!alias && !!token && validateAuth(alias, token) }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
